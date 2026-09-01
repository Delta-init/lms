/* ─────────────────────────────────────────────────────────────
   LMS ↔ CLT Connect — Phase 2: provider field, capacity rule, S2S client.

   Nothing user-visible ships in this phase, so the things worth proving are
   the ones that would otherwise only surface later and badly:

     - every existing class is still Mux, without a migration
     - a LiveKit class cannot be created larger than the room can hold
     - the S2S signature is what CLT will actually be able to verify
     - a meeting-platform outage does not stop a class being scheduled

   The S2S client is exercised against a local HTTP server standing in for CLT,
   so the signing is verified byte-for-byte rather than assumed.

   Run: bun run test:integration2
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_integration2'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''

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
const { createHmac } = await import('node:crypto')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_integration2') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

/* ── A stand-in for CLT: records what it received so the signature the LMS
      actually sends can be verified the way CLT will verify it. ── */
interface Received { path: string; body: string; headers: Record<string, string> }
const received: Received[] = []
let respond: (path: string) => { status: number; body: unknown } = () => ({ status: 200, body: { courseId: 42, roomName: 'x' } })

const fakeClt = createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    received.push({
      path: req.url ?? '',
      body,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
    })
    const r = respond(req.url ?? '')
    res.writeHead(r.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(r.body))
  })
})
await new Promise<void>(r => fakeClt.listen(0, () => r()))
const CLT_PORT = (fakeClt.address() as { port: number }).port

const SECRET = 'test-s2s-secret-0123456789abcdef'
process.env.CLT_BASE_URL   = `http://127.0.0.1:${CLT_PORT}`
process.env.CLT_S2S_SECRET = SECRET

const clt = await import('@/services/clt.service.ts')
const { LiveClassModel, OrganizationModel, CourseModel, UserModel } = await import('@/models/schema.ts')
const { LiveClassService, LIVEKIT_MAX_PARTICIPANTS } = await import('@/services/liveClass.service.ts')
const { roomNameFor } = await import('@/services/integrationTicket.service.ts')

try {
  const org = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const instructor = await UserModel.create({
    name: 'Mentor', email: 'mentor@t.local', passwordHash: 'x', role: 'instructor',
    isActive: true, organizationId: org._id,
  })
  const course = await CourseModel.create({
    title: 'Course', slug: 'course-' + Date.now(), description: 'd',
    instructorId: instructor._id, price: 0, isFree: true, status: 'published',
    language: 'English', organizationId: org._id,
  })
  const svc = new LiveClassService()
  const base = {
    courseId: String(course._id), instructorId: String(instructor._id),
    title: 'Session', durationMins: 60, organizationId: String(org._id),
  }

  /* ═══════════════════════════════════════════════ */
  section('A · the provider defaults to Mux — no migration, no behaviour change')
  const legacy = await LiveClassModel.create({
    courseId: course._id, instructorId: instructor._id, title: 'Legacy',
    scheduledStart: new Date(Date.now() + 86_400_000), durationMins: 60, type: 'external',
  })
  check('a class created without a provider is Mux',
    (legacy as { provider?: string }).provider === 'mux', String((legacy as { provider?: string }).provider))
  check('the field is a real enum, not free text',
    LiveClassModel.schema.path('provider').options.enum.join(',') === 'mux,livekit')

  section('B · CAPACITY — a LiveKit room cannot be oversold')
  /* Asserted against the CONFIGURED value rather than a literal: the cap must
     track room.max_participants in the deployed livekit yaml (prod = 30), so
     hard-coding a number here would just be a second place to forget. */
  check('the cap is configured and plausible for an SFU room',
    Number.isInteger(LIVEKIT_MAX_PARTICIPANTS) && LIVEKIT_MAX_PARTICIPANTS > 0 && LIVEKIT_MAX_PARTICIPANTS <= 100,
    String(LIVEKIT_MAX_PARTICIPANTS))
  check('it matches LIVEKIT_MAX_PARTICIPANTS from the environment',
    LIVEKIT_MAX_PARTICIPANTS === Number(process.env['LIVEKIT_MAX_PARTICIPANTS'] ?? 50),
    `${LIVEKIT_MAX_PARTICIPANTS} vs env ${process.env['LIVEKIT_MAX_PARTICIPANTS']}`)

  let capErr: any = null
  try {
    await svc.create({
      ...base, scheduledStart: new Date(Date.now() + 86_400_000),
      type: 'internal', provider: 'livekit', sessionCapacity: 500,
    })
  } catch (e) { capErr = e }
  check('a 500-seat LiveKit class is refused', !!capErr, 'this is the 500-vs-50 mismatch from plan §9')
  check('with a specific, actionable code',
    capErr?.code === 'LIVEKIT_CAPACITY_EXCEEDED', capErr?.code)
  check('and a 400, not a 500 — it is the caller’s input that is wrong',
    capErr?.statusCode === 400 || capErr?.status === 400, String(capErr?.statusCode ?? capErr?.status))
  check('the message names the ACTUAL limit so the admin can act on it',
    new RegExp(String(LIVEKIT_MAX_PARTICIPANTS)).test(String(capErr?.message)), capErr?.message)

  /* The same 500 seats on Mux must still be fine — the cap is LiveKit's, not the LMS's. */
  const bigMux = await svc.create({
    ...base, scheduledStart: new Date(Date.now() + 86_400_000),
    type: 'external', meetingUrl: 'https://meet.example.com/x', sessionCapacity: 500,
  })
  check('500 seats is still allowed for a non-LiveKit class',
    bigMux.sessionCapacity === 500, String(bigMux.sessionCapacity))

  const atLimit = await svc.create({
    ...base, scheduledStart: new Date(Date.now() + 86_400_000),
    type: 'internal', provider: 'livekit', sessionCapacity: LIVEKIT_MAX_PARTICIPANTS,
  })
  check('exactly at the limit is accepted', atLimit.sessionCapacity === LIVEKIT_MAX_PARTICIPANTS)

  section('C · room provisioning')
  check('the room name is derived from the class id',
    atLimit.cltRoomName === roomNameFor(atLimit.id), String(atLimit.cltRoomName))
  check('the CLT course id returned by the room call is stored',
    atLimit.cltCourseId === 42, String(atLimit.cltCourseId))

  const roomCall = received.find(r => r.path === '/api/lms/rooms')
  check('the LMS called POST /api/lms/rooms', !!roomCall, JSON.stringify(received.map(r => r.path)))
  const sent = JSON.parse(roomCall!.body)
  check('it sent the class id, room, capacity and duration',
    sent.liveClassId === atLimit.id && sent.roomName === atLimit.cltRoomName
    && sent.capacity === LIVEKIT_MAX_PARTICIPANTS && sent.durationMins === 60,
    roomCall!.body)
  check('scheduledStart carries a timezone, never a naive local time',
    /Z|[+-]\d{2}:\d{2}$/.test(sent.scheduledStart),
    `${sent.scheduledStart} — the LMS runs Asia/Dubai and CLT computes in UTC`)

  section('D · the S2S signature is one CLT can verify')
  const h = roomCall!.headers
  check('timestamp, nonce and signature are all sent',
    !!h['x-lms-timestamp'] && !!h['x-lms-nonce'] && !!h['x-lms-signature'])
  const expected = createHmac('sha256', SECRET)
    .update(`${h['x-lms-timestamp']}.${h['x-lms-nonce']}.${roomCall!.body}`).digest('hex')
  check('the signature is HMAC-SHA256 over timestamp.nonce.body',
    h['x-lms-signature'] === expected, `${h['x-lms-signature']} != ${expected}`)
  check('the timestamp is recent, so CLT can reject a replayed capture',
    Math.abs(Date.now() - Number(h['x-lms-timestamp'])) < 60_000)

  /* Tamper with the body and the signature must no longer match. */
  const tamperedSig = createHmac('sha256', SECRET)
    .update(`${h['x-lms-timestamp']}.${h['x-lms-nonce']}.${roomCall!.body.replace('60', '9999')}`).digest('hex')
  check('editing the body invalidates the signature', tamperedSig !== h['x-lms-signature'])
  check('a different secret produces a different signature',
    createHmac('sha256', 'wrong-secret').update(`${h['x-lms-timestamp']}.${h['x-lms-nonce']}.${roomCall!.body}`).digest('hex')
    !== h['x-lms-signature'])
  check('signaturesMatch is length-safe', clt.signaturesMatch('abc', 'abc') && !clt.signaturesMatch('abc', 'abcd'))

  section('E · a CLT outage does not stop a class being scheduled')
  respond = () => ({ status: 503, body: { detail: 'down' } })
  const duringOutage = await svc.create({
    ...base, scheduledStart: new Date(Date.now() + 86_400_000),
    type: 'internal', provider: 'livekit', sessionCapacity: 20,
  })
  check('the class is still created when CLT is down', !!duringOutage.id)
  check('the room name is still recorded, so it can be provisioned later',
    duringOutage.cltRoomName === roomNameFor(duringOutage.id))
  check('but no CLT course id is invented', duringOutage.cltCourseId === undefined,
    String(duringOutage.cltCourseId))
  respond = () => ({ status: 200, body: { courseId: 42, roomName: 'x' } })

  section('F · an unconfigured deployment stays inert')
  const savedBase = process.env.CLT_BASE_URL
  process.env.CLT_BASE_URL = ''
  check('cltConfigured() reports false with no base url', clt.cltConfigured() === false)
  check('tryEnsureRoom returns null rather than throwing',
    (await clt.tryEnsureRoom({
      liveClassId: 'x', roomName: 'lms-x', title: 't',
      scheduledStart: new Date().toISOString(), durationMins: 60, capacity: 10,
    })) === null)
  let threw = false
  try { await clt.ensureRoom({
    liveClassId: 'x', roomName: 'lms-x', title: 't',
    scheduledStart: new Date().toISOString(), durationMins: 60, capacity: 10,
  }) } catch { threw = true }
  check('the strict ensureRoom DOES throw, so callers can surface a 503', threw)
  process.env.CLT_BASE_URL = savedBase

  section('G · Mux classes are untouched by any of this')
  const before = await LiveClassModel.countDocuments({ provider: 'mux' })
  check('mux-provider rows exist alongside livekit ones', before >= 2, String(before))
  check('a livekit class never gets Mux fields',
    !atLimit.muxLiveStreamId && !atLimit.muxPlaybackId)

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  fakeClt.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
