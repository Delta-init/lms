/* ─────────────────────────────────────────────────────────────
   H-11 / N-06 — identity scans are readable only by people entitled to them.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_kyc_suite), dropped on exit. The real `lms` database is never opened.

   The finding: passport and national-ID scans were served from permanent
   public URLs with `immutable` caching. Anyone holding the link could read
   them forever and nothing could revoke it. They now live under `kyc/`, which
   the static handler refuses, and are reachable only through
   GET /documents/:userId/:field, which authorises first.

   ── Phase F carries a control, and that is deliberate ──
   Checking "kyc/ is refused" on its own is worth very little: a broken static
   mount would refuse everything and read as a pass. The unauthenticated probe
   written for this same finding (`bun run verify-kyc`) reported a clean bill
   of health for exactly that reason before it was corrected — every 404 it
   saw was a missing object, not a closed door. So phase F also asserts that a
   NON-kyc file IS served. A refusal only means something when the same path
   demonstrably works for something else.

   Run: bun run test:kyc
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_kyc_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.BACKEND_PUBLIC_URL = 'http://127.0.0.1:8000'
/* Force local disk — otherwise this suite would read and sign against the
   production R2 buckets. Blanked before anything reads the env config; dotenv
   never overwrites a key already present, and `opt()` reads '' as unset. */
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
process.env.RATE_LIMIT_AUTH_MAX  = '200'

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
const fs   = await import('fs/promises')
const path = await import('path')
const app  = (await import('@/app.ts')).default
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_kyc_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const PORT = (server.address() as { port: number }).port
const BASE = `http://127.0.0.1:${PORT}/api/v1`
const ROOT = `http://127.0.0.1:${PORT}`

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])
const written: string[] = []

/** Put a real file on disk where the route expects to find it. */
async function place(key: string): Promise<string> {
  const abs = path.join(process.cwd(), 'uploads', key)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, PNG)
  written.push(abs)
  return key
}

type Jar = Map<string, string>
async function call(method: string, url: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const buf  = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body, bytes: buf, headers: res.headers }
}

const PW = 'CorrectHorse1'

try {
  const dubai     = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const bangalore = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)

  const passportKey = await place(`kyc/passport-${Date.now()}.png`)
  const idDocKey    = await place(`kyc/iddoc-${Date.now()}.png`)
  const publicKey   = await place(`documents/avatar-${Date.now()}.png`)
  const legacyUrl   = `http://127.0.0.1:8000/uploads/${publicKey}`

  const mk = (email: string, role: string, org: unknown, extra: object = {}) =>
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true, organizationId: org, ...extra })

  const student = await mk('student@t.local', 'student', dubai._id, {
    enrollmentApplication: { passportUrl: passportKey, idDocUrl: idDocKey },
  })
  const legacyStudent = await mk('legacy@t.local', 'student', dubai._id, {
    enrollmentApplication: { passportUrl: legacyUrl },
  })
  const noDocs     = await mk('nodocs@t.local',   'student',    dubai._id)
  const other      = await mk('other@t.local',    'student',    dubai._id)
  const instructor = await mk('teacher@t.local',  'instructor', dubai._id)
  await mk('dubai.admin@t.local',     'admin',       dubai._id)
  await mk('bangalore.admin@t.local', 'admin',       bangalore._id)
  await mk('root@t.local',            'super_admin', bangalore._id)
  const ghostAdmin = await mk('ghost@t.local', 'admin', dubai._id)

  const loginAs = async (email: string, portal: 'client' | 'admin' = 'client') => {
    const jar: Jar = new Map()
    const r = await call('POST', `${BASE}${portal === 'admin' ? '/admin/auth/login' : '/auth/login'}`, { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} (${portal}): ${r.status}`)
    return jar
  }
  const doc = (userId: unknown, field: string, jar?: Jar) =>
    call('GET', `${BASE}/documents/${userId}/${field}`, { jar })

  section('A — the owner can read their own scans')
  {
    const jar = await loginAs('student@t.local')
    const r = await doc(student._id, 'passport', jar)
    check('owner gets their passport', r.status === 200, `got ${r.status}`)
    check('the bytes are the stored file, not a public URL',
      r.bytes.subarray(0, 4).toString('hex') === '89504e47', r.bytes.subarray(0, 8).toString('hex'))
    check('it is marked uncacheable, so it cannot linger in a shared cache',
      (r.headers.get('cache-control') ?? '').includes('no-store'), r.headers.get('cache-control') ?? '')
    check('owner gets their ID document too', (await doc(student._id, 'idDoc', jar)).status === 200)
  }

  section('B — nobody else on the platform can  ← the whole point of the finding')
  {
    check('an anonymous caller is refused', (await doc(student._id, 'passport')).status === 401,
      `got ${(await doc(student._id, 'passport')).status}`)

    const otherJar = await loginAs('other@t.local')
    const asOther = await doc(student._id, 'passport', otherJar)
    check('another student is refused', asOther.status === 404, `got ${asOther.status}`)
    check('...and told nothing about whether the document exists',
      asOther.body?.error?.code === 'NOT_FOUND', asOther.body?.error?.code)

    /* Instructors are deliberately NOT staff here — H-05 was exactly this. */
    const teacherJar = await loginAs('teacher@t.local')
    check('an instructor is refused', (await doc(student._id, 'passport', teacherJar)).status === 404)
  }

  section('C — staff may read, but only inside their own academy')
  {
    const dubaiJar = await loginAs('dubai.admin@t.local', 'admin')
    check('an admin of the same academy can read', (await doc(student._id, 'passport', dubaiJar)).status === 200)

    const blrJar = await loginAs('bangalore.admin@t.local', 'admin')
    const cross = await doc(student._id, 'passport', blrJar)
    check('the other academy\'s admin is refused', cross.status === 404, `got ${cross.status}`)

    /* The caller's academy is read from the DATABASE, not req.user: this route
       uses authenticateAny, which never populates organizationId. Trusting the
       token left it undefined and the comparison failed open. */
    const rootJar = await loginAs('root@t.local', 'admin')
    check('super_admin is unscoped, matching every other tenancy guard',
      (await doc(student._id, 'passport', rootJar)).status === 200)

    const ghostJar = await loginAs('ghost@t.local', 'admin')
    await UserModel.findByIdAndDelete(ghostAdmin._id)
    const ghost = await doc(student._id, 'passport', ghostJar)
    check('a staff account deleted mid-session is refused', ghost.status === 404 || ghost.status === 401,
      `got ${ghost.status}`)
  }

  section('D — the field and id are validated, not passed through')
  {
    const jar = await loginAs('student@t.local')
    const unknown = await doc(student._id, 'avatar', jar)
    check('an unknown field is rejected', unknown.status === 400 && unknown.body?.error?.code === 'INVALID_FIELD',
      `got ${unknown.status} ${unknown.body?.error?.code}`)

    const traversal = await call('GET', `${BASE}/documents/${student._id}/..%2f..%2fpackage.json`, { jar })
    check('a traversal attempt in the field is rejected', traversal.status === 400 || traversal.status === 404,
      `got ${traversal.status}`)

    const badId = await doc('not-an-objectid', 'passport', jar)
    check('a malformed user id is rejected', badId.status === 400 && badId.body?.error?.code === 'INVALID_ID',
      `got ${badId.status} ${badId.body?.error?.code}`)

    const missing = await (async () => {
      const own = await loginAs('nodocs@t.local')
      return doc(noDocs._id, 'passport', own)
    })()
    check('a user with no document gets a plain 404', missing.status === 404, `got ${missing.status}`)
  }

  section('E — rows not yet migrated still work, so nothing breaks before the move')
  {
    const jar = await loginAs('legacy@t.local')
    const r = await doc(legacyStudent._id, 'passport', jar)
    check('a legacy public URL is still served', r.status === 200, `got ${r.status}`)
    check('...and is flagged as legacy so it can be found and migrated',
      r.body?.data?.legacy === true, JSON.stringify(r.body?.data))
  }

  section('F — the static path refuses kyc/  ← with a control, or it proves nothing')
  {
    /* THE CONTROL FIRST. A broken static mount refuses everything, which would
       make every assertion below pass while proving the opposite. */
    const control = await call('GET', `${ROOT}/uploads/${publicKey}`)
    check('CONTROL: a non-kyc upload IS served statically', control.status === 200, `got ${control.status}`)
    check('CONTROL: and returns the real bytes',
      control.bytes.subarray(0, 4).toString('hex') === '89504e47')

    const direct = await call('GET', `${ROOT}/uploads/${passportKey}`)
    check('the same path refuses a kyc/ object', direct.status === 404, `got ${direct.status}`)

    /* P-23: Express matches routes case-sensitively, the filesystem underneath
       does not. A mount on the literal '/uploads/kyc' let this through. */
    const upper = await call('GET', `${ROOT}/uploads/${passportKey.replace(/^kyc\//, 'KYC/')}`)
    check('...and refuses the uppercase variant too', upper.status === 404, `got ${upper.status}`)
    const mixed = await call('GET', `${ROOT}/uploads/${passportKey.replace(/^kyc\//, 'Kyc/')}`)
    check('...and mixed case', mixed.status === 404, `got ${mixed.status}`)

    const traverse = await call('GET', `${ROOT}/uploads/documents/../${passportKey}`)
    check('...and a traversal back into kyc/', traverse.status === 404, `got ${traverse.status}`)
  }

} finally {
  for (const abs of written) { try { await fs.unlink(abs) } catch {} }
  lines.push(`\n(cleanup: removed ${written.length} local fixture(s))`)
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
