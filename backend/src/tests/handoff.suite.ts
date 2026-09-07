/* ─────────────────────────────────────────────────────────────
   Phase 1 — the redirect handoff.

   A browser is sent to CLT Connect carrying a one-time code instead of a
   ticket. This suite is about the two properties that make that safe:

     1. the code is worthless on its own      — unsigned callers get nothing
     2. authorisation happens at EXCHANGE     — not when the code was issued

   The second is the design decision worth defending. Issuing a code records
   an intent; the entitlement check runs when CLT redeems it. So a class
   cancelled, or a booking withdrawn, in the seconds between clicking Join and
   arriving is still honoured. Two tests below revoke access AFTER a code is
   issued and prove the code is then worthless.

   Run: bun run test:handoff
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_handoff'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

import { generateKeyPairSync, createHmac, createHash } from 'node:crypto'
const { privateKey } = generateKeyPairSync('ed25519')
process.env.INTEGRATION_JWT_PRIVATE_KEY =
  Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64')
process.env.INTEGRATION_JWT_KID = 'handoff-key'

const SECRET = 'handoff-s2s-secret'
process.env.CLT_S2S_SECRET = SECRET

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { createServer } = await import('node:http')

/* A stand-in CLT so room provisioning succeeds without the real service. */
const fakeClt = createServer((req, res) => {
  let b = ''
  req.on('data', c => { b += c })
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ courseId: 7, roomName: JSON.parse(b || '{}').roomName, courseCode: 'H1' }))
  })
})
await new Promise<void>(r => fakeClt.listen(0, () => r()))
process.env.CLT_BASE_URL = `http://127.0.0.1:${(fakeClt.address() as { port: number }).port}`

const app = (await import('@/app.ts')).default
const {
  LiveClassModel, OrganizationModel, CourseModel, UserModel,
  ClassBookingModel, EnrollmentModel, ClassHandoffModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_handoff') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

/** Sign exactly as CLT's lms_handoff.py does: over the CODE, not the body. */
function signed(code: string, opts: { secret?: string; timestamp?: string; signCode?: string } = {}) {
  const timestamp = opts.timestamp ?? String(Date.now())
  const nonce     = Math.random().toString(16).slice(2)
  const signature = createHmac('sha256', opts.secret ?? SECRET)
    .update(`${timestamp}.${nonce}.${opts.signCode ?? code}`).digest('hex')
  return { 'X-CLT-Timestamp': timestamp, 'X-CLT-Nonce': nonce, 'X-CLT-Signature': signature }
}

const exchange = (code: string, headers: Record<string, string>) =>
  call('POST', '/integrations/handoff/exchange', { body: { code }, headers })

async function claimsOf(ticket: string): Promise<any> {
  const { jwtVerify, importJWK } = await import('jose')
  const keys = await import('@/utils/integrationKeys.ts')
  const { keys: published } = await keys.publicJwks()
  const key = await importJWK(published[0] as never, 'EdDSA')
  const { payload } = await jwtVerify(ticket, key, {
    issuer: 'lms.deltainstitutions', audience: 'clt-connect', algorithms: ['EdDSA'],
  })
  return payload
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

function codeFrom(body: any): string {
  const u = new URL(body.data.url)
  return u.searchParams.get('c') ?? ''
}

const PW = 'CorrectHorse1'

try {
  const org = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)

  const teacher = await UserModel.create({
    name: 'T', email: 't@h.local', passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })
  const student = await UserModel.create({
    name: 'S', email: 's@h.local', passwordHash: hash, role: 'student',
    isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
  })

  const course = await CourseModel.create({
    title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
  })
  const mkClass = () => LiveClassModel.create({
    courseId: course._id, instructorId: teacher._id, title: 'Live now',
    scheduledStart: new Date(Date.now() - 5 * 60_000), durationMins: 60,
    type: 'internal', provider: 'livekit', status: 'live',
    sessionCapacity: 30, organizationId: org._id,
  })
  const live = await mkClass()

  await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active' })
  await ClassBookingModel.create({ userId: student._id, liveClassId: live._id, status: 'booked' })

  /* Each portal is signed into through its OWN login, because each handoff is
     now guarded by its own cookie. An instructor works from the admin app. */
  const tJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: tJar, body: { email: 't@h.local', password: PW } })
  const sJar: Jar = new Map()
  await call('POST', '/auth/login', { jar: sJar, body: { email: 's@h.local', password: PW } })

  /* The two paths, named once. They are NOT interchangeable — section I. */
  const hostHandoff    = (id: unknown) => `/admin/live-classes/${id}/handoff`
  const studentHandoff = (id: unknown) => `/live-classes/${id}/handoff`

  /* ═══════════════════════════════════════════════ */
  section('A · the URL carries a code, never a credential')
  const issued = await call('POST', hostHandoff(live._id), { jar: tJar, body: {} })
  check('an instructor gets a handoff url', issued.status === 200, String(issued.status))
  const url = String(issued.body?.data?.url ?? '')
  check('it points at the meeting platform', url.includes('/lms/enter?c='), url)
  check('and contains NO ticket', !/ey[A-Za-z0-9_-]{20,}\./.test(url), url)
  check('the code is long enough to be unguessable', codeFrom(issued.body).length >= 32)

  const stored = await ClassHandoffModel.findOne({}).lean() as any
  check('the code is stored HASHED, never in the clear',
    !!stored?.codeHash && stored.codeHash !== codeFrom(issued.body) && stored.codeHash.length === 64)
  check('and no ticket is stored at rest', stored?.ticket === undefined)

  /* ═══════════════════════════════════════════════ */
  section('B · only a signed caller can exchange it')
  const code = codeFrom(issued.body)

  const bare = await exchange(code, {})
  check('an unsigned exchange is refused', bare.status === 401, String(bare.status))

  const wrongSecret = await exchange(code, signed(code, { secret: 'not-the-secret' }))
  check('a wrong secret is refused', wrongSecret.status === 401, String(wrongSecret.status))

  const stale = await exchange(code, signed(code, { timestamp: String(Date.now() - 10 * 60_000) }))
  check('a ten-minute-old timestamp is refused', stale.status === 401, String(stale.status))

  /* The property an empty-body signature would have lost. */
  const otherCode = 'B'.repeat(43)
  const crossed = await exchange(otherCode, signed(otherCode, { signCode: code }))
  check('a signature minted for ANOTHER code is refused — one signature, one code',
    crossed.status === 401, String(crossed.status))

  /* ═══════════════════════════════════════════════ */
  section('C · single use, and only once')
  const first = await exchange(code, signed(code))
  check('a signed exchange returns a ticket', first.status === 200 && !!first.body?.data?.ticket,
    `${first.status} ${JSON.stringify(first.body?.error ?? '')}`)
  check('with the room name', !!first.body?.data?.roomName)
  check('and an instructor is never hidden', first.body?.data?.hidden === false)

  const replay = await exchange(code, signed(code))
  check('replaying the same code is refused', replay.status === 409, String(replay.status))

  const unknown = 'Z'.repeat(43)
  const bogus = await exchange(unknown, signed(unknown))
  check('an invented code is refused', bogus.status === 409, String(bogus.status))
  check('and is INDISTINGUISHABLE from a spent one — no oracle for real codes',
    bogus.body?.error?.code === replay.body?.error?.code,
    `${bogus.body?.error?.code} vs ${replay.body?.error?.code}`)

  section('D · an expired code is refused even before the TTL sweep runs')
  {
    const c2 = await mkClass()
    const iss = await call('POST', hostHandoff(c2._id), { jar: tJar, body: {} })
    const cd  = codeFrom(iss.body)
    /* Mongo's TTL monitor runs about once a minute, so a spent row lingers.
       Redemption must check the clock itself rather than trust the row's
       absence — age it by hand and prove it does. */
    await ClassHandoffModel.updateOne({ codeHash: { $exists: true }, usedAt: { $exists: false } },
      { $set: { expiresAt: new Date(Date.now() - 1000) } })
    const r = await exchange(cd, signed(cd))
    check('an expired code is refused with its own reason', r.status === 410,
      `${r.status} ${r.body?.error?.code}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('E · authorisation happens at EXCHANGE, not at issue')
  /* The reason the ticket is minted late. A code issued a minute ago must not
     outlive the permission it was issued under. */
  {
    const c3 = await mkClass()
    const iss = await call('POST', hostHandoff(c3._id), { jar: tJar, body: {} })
    check('a code is issued while the class is live', iss.status === 200, String(iss.status))
    /* …and THEN the class is cancelled. */
    await LiveClassModel.updateOne({ _id: c3._id }, { $set: { status: 'cancelled' } })
    const cd = codeFrom(iss.body)
    const r = await exchange(cd, signed(cd))
    check('cancelling the class AFTER issue makes the code worthless',
      r.status === 409 && r.body?.error?.code === 'CLASS_CANCELLED',
      `${r.status} ${r.body?.error?.code}`)
  }
  {
    const c4 = await mkClass()
    await ClassBookingModel.create({ userId: student._id, liveClassId: c4._id, status: 'booked' })
    const iss = await call('POST', studentHandoff(c4._id), { jar: sJar, body: {} })
    check('a booked student is issued a code', iss.status === 200, String(iss.status))
    /* …and THEN the booking is withdrawn. */
    await ClassBookingModel.updateOne({ userId: student._id, liveClassId: c4._id }, { $set: { status: 'cancelled' } })
    const cd = codeFrom(iss.body)
    const r = await exchange(cd, signed(cd))
    check('withdrawing the booking AFTER issue makes the code worthless',
      r.status === 403 && r.body?.error?.code === 'NOT_BOOKED',
      `${r.status} ${r.body?.error?.code}`)
  }

  section('F · a student cannot obtain a HOST handoff')
  {
    const c5 = await mkClass()
    const iss = await call('POST', studentHandoff(c5._id), { jar: sJar, body: { visible: true } })
    check('a student asking with visible:true still gets a student code', iss.status === 403 || iss.status === 200,
      String(iss.status))
    if (iss.status === 200) {
      const cd = codeFrom(iss.body)
      const r = await exchange(cd, signed(cd))
      /* No booking on this class, so the student path refuses — proving the
         request was treated as a STUDENT join and not a host one. */
      check('and it is redeemed on the STUDENT path, which refuses without a booking',
        r.status === 403 && r.body?.error?.code === 'NOT_BOOKED',
        `${r.status} ${r.body?.error?.code}`)
    }
  }

  section('G · there is no longer a mode to get wrong')
  /* Phase 6 deleted the embed path, so `joinMode` is gone from both payloads
     and LIVE_CLASS_HANDOFF no longer exists. A leftover flag would be worse
     than none: someone would set it, nothing would change, and they would
     trust a switch that does nothing. */
  {
    const adminSide = await call('GET', `/admin/live-classes/${live._id}`, { jar: tJar })
    check('the admin payload advertises no joinMode',
      adminSide.status !== 200 || adminSide.body?.data?.joinMode === undefined,
      String(adminSide.body?.data?.joinMode))

    /* And the flag is genuinely inert — setting it changes nothing. */
    const before = process.env['LIVE_CLASS_HANDOFF']
    process.env['LIVE_CLASS_HANDOFF'] = 'embed'
    const c = await mkClass()
    const iss = await call('POST', hostHandoff(c._id), { jar: tJar, body: {} })
    check('a handoff is still issued even with the old flag set to embed',
      iss.status === 200, `${iss.status} — the flag must be inert, not honoured`)
    if (before === undefined) delete process.env['LIVE_CLASS_HANDOFF']
    else process.env['LIVE_CLASS_HANDOFF'] = before
  }

  section('H · the ticket carries what Phase 5 added')
  {
    const c = await mkClass()
    const iss = await call('POST', hostHandoff(c._id), { jar: tJar, body: {} })
    const cd = codeFrom(iss.body)
    const r = await exchange(cd, signed(cd))
    check('an instructor exchange still succeeds', r.status === 200, String(r.status))
    if (r.status === 200) {
      const claims = await claimsOf(r.body.data.ticket)
      check('an instructor is not offered the unhide control — they are never hidden',
        claims.grants.mayUnhide === undefined || claims.grants.mayUnhide === false,
        JSON.stringify(claims.grants))
    }
  }

  /* ═══════════════════════════════════════════════ */
  section('I · one browser, both cookies — the portal decides, not precedence')
  {
    /* The bug this pins: `authenticateAny` reads whichever session cookie it
       finds and PREFERS the admin one. In development both portals are
       localhost (ports do not scope cookies) and in production they may share
       an apex domain, so one browser can genuinely hold both at once.

       When it did, a student pressing "Join the class" on their own dashboard
       was handed the ADMIN's hidden observer ticket — a session belonging to
       somebody else, obtained by nothing more than sitting at the keyboard.
       Splitting the handoff across the two routers removes the contest: the
       student router cannot see the admin cookie at all. */
    /* Carry the student's existing device cookie across. This section is
       about ONE browser holding both portals' sessions, and a browser is now
       also a device: students are limited to two approved ones, and a fresh
       jar reads as a brand-new device that sits 'pending' until an admin lets
       it in — so the student's login here silently set no cookie and the
       whole section tested nothing. Reusing the device makes the jar what the
       test always claimed it was: the same browser, twice signed in. */
    const both: Jar = new Map()
    const studentDevice = [...sJar.entries()].find(([k]) => k.startsWith('lms_device'))
    if (studentDevice) both.set(studentDevice[0], studentDevice[1])

    await call('POST', '/auth/login',       { jar: both, body: { email: 's@h.local', password: PW } })
    await call('POST', '/admin/auth/login', { jar: both, body: { email: 't@h.local', password: PW } })
    check('the jar really does hold both portals at once',
      [...both.keys()].some(k => k.startsWith('lms_at')) &&
      [...both.keys()].some(k => k.startsWith('lms_admin_at')),
      [...both.keys()].join(','))

    const c6 = await mkClass()
    await ClassBookingModel.create({ userId: student._id, liveClassId: c6._id, status: 'booked' })

    const asStudent = await call('POST', studentHandoff(c6._id), { jar: both, body: {} })
    check('the student door still opens', asStudent.status === 200, String(asStudent.status))
    const row = await ClassHandoffModel.findOne({ codeHash: sha256(codeFrom(asStudent.body)) }).lean() as any
    check('and it issues for the STUDENT, not the admin sharing the browser',
      String(row?.userId) === String(student._id),
      `${row?.userId} vs student ${student._id}`)
    check('so the kind is student, and no observer ticket is on offer',
      row?.kind === 'student', String(row?.kind))

    /* The reverse too: asking the student door for a HOST entry cannot work
       even with an admin cookie present, because that door never reads it. */
    const sneak = await call('POST', studentHandoff(c6._id), { jar: both, body: { visible: true } })
    const sneakRow = await ClassHandoffModel.findOne({ codeHash: sha256(codeFrom(sneak.body)) }).lean() as any
    check('a `visible: true` body cannot promote a student through it',
      sneakRow?.kind === 'student' && sneakRow?.visible === undefined,
      `kind=${sneakRow?.kind} visible=${sneakRow?.visible}`)

    const asHost = await call('POST', hostHandoff(c6._id), { jar: both, body: {} })
    const hostRow = await ClassHandoffModel.findOne({ codeHash: sha256(codeFrom(asHost.body)) }).lean() as any
    check('the admin door resolves the ADMIN session from that same jar',
      String(hostRow?.userId) === String(teacher._id) && hostRow?.kind === 'host',
      `${hostRow?.userId} kind=${hostRow?.kind}`)

    /* Each door is deaf to the other's cookie. */
    const adminOnly: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: adminOnly, body: { email: 't@h.local', password: PW } })
    const noStudentCookie = await call('POST', studentHandoff(c6._id), { jar: adminOnly, body: {} })
    check('an admin-only browser gets 401 from the student door, not a ticket',
      noStudentCookie.status === 401, String(noStudentCookie.status))

    const studentOnly: Jar = new Map()
    await call('POST', '/auth/login', { jar: studentOnly, body: { email: 's@h.local', password: PW } })
    const noAdminCookie = await call('POST', hostHandoff(c6._id), { jar: studentOnly, body: {} })
    check('a student-only browser gets 401 from the admin door',
      noAdminCookie.status === 401, String(noAdminCookie.status))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
  fakeClt.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
