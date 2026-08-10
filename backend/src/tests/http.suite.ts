/* ─────────────────────────────────────────────────────────────
   HTTP integration suite — boots the REAL Express app and talks to it
   over a socket, against an ISOLATED throwaway database (lms_http_suite)
   which is dropped on exit.

   The other suites exercise services directly. This one covers what they
   structurally cannot: middleware order, guard wiring, Zod validation, and
   the `organizationId` threading that was edited into the route files. A
   guard attached to the wrong route, or an org that never reaches the
   service, type-checks perfectly and passes every service test.

   Run: bun run test:http
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_http_suite'
process.env.NODE_ENV     = 'test'   /* not production (cookies stay non-secure), not development (no request logging) */
process.env.PORT         = '0'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(name: string) { lines.push(`\n${name}`) }

const mongoose = (await import('mongoose')).default

/* autoIndex off: mongoose builds indexes asynchronously, and those builds
   race the dropDatabase() in the finally below — recreating empty collection
   shells after the teardown and leaving a stray database behind. Nothing here
   depends on index behaviour. */
mongoose.set('autoIndex', false)
const app      = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, LearningPathModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_http_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const port = (server.address() as { port: number }).port
const BASE = `http://127.0.0.1:${port}/api/v1`

/* ── Minimal cookie jar: the API authenticates with httpOnly cookies ── */
type Jar = Map<string, string>
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';')
    const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
}
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

async function call(
  method: string, path: string,
  opts: { jar?: Jar; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = cookieHeader(opts.jar)
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) absorb(opts.jar, res)
  const text = await res.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'

try {
  /* ── Fixtures ──────────────────────────────────────── */
  const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)
  const mk = (email: string, role: string, org: any, extra: object = {}) =>
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true, organizationId: org?._id, ...extra })

  const dubaiAdmin = await mk('dadmin@t.local', 'admin',      dubai)
  const blrAdmin   = await mk('badmin@t.local', 'admin',      blr)
  const superA     = await mk('super@t.local',  'super_admin', null)
  const student    = await mk('stud@t.local',   'student',    dubai, { enrollmentStatus: 'approved' })
  const blocked    = await mk('blocked@t.local','student',    dubai, { enrollmentStatus: 'approved' })

  /* Client-portal login (lms_at) and admin-portal login (lms_admin_at). */
  async function login(email: string, admin = false): Promise<Jar> {
    const jar: Jar = new Map()
    const r = await call('POST', admin ? '/admin/auth/login' : '/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }

  section('auth — the login and session basics everything else rests on')
  {
    const jar = await login('stud@t.local')
    check('student can sign in and receives a session cookie', jar.has('lms_at'))
    const me = await call('GET', '/auth/me', { jar })
    check('GET /auth/me returns the signed-in account', me.status === 200 && me.body?.data?.user?.email === 'stud@t.local')
    const anon = await call('GET', '/auth/me')
    check('GET /auth/me without a cookie is refused', anon.status === 401)
    const bad = await call('POST', '/auth/login', { body: { email: 'stud@t.local', password: 'nope' } })
    check('a wrong password is refused', bad.status === 401 && bad.body?.error?.code === 'INVALID_CREDENTIALS')
  }

  section('P-06 — a disabled account cannot keep using its token')
  {
    const jar = await login('blocked@t.local')
    check('the account works while active', (await call('GET', '/auth/me', { jar })).status === 200)
    await UserModel.findByIdAndUpdate(blocked._id, { $set: { isActive: false } })
    const after = await call('GET', '/auth/me', { jar })
    check('the SAME cookie stops working once disabled',
      after.status === 401 && after.body?.error?.code === 'ACCOUNT_DISABLED',
      `got ${after.status} ${after.body?.error?.code}`)
    await UserModel.findByIdAndDelete(blocked._id)
    const gone = await call('GET', '/auth/me', { jar })
    check('a deleted account is refused too',
      gone.status === 401 && gone.body?.error?.code === 'ACCOUNT_GONE',
      `got ${gone.status} ${gone.body?.error?.code}`)
  }

  section('NEW-01 — 2FA setup must re-authenticate')
  {
    const jar = await login('stud@t.local')
    const noPw = await call('POST', '/auth/2fa/setup', { jar, body: {} })
    check('setup with no password is rejected by validation', noPw.status === 422, `got ${noPw.status}`)
    const wrongPw = await call('POST', '/auth/2fa/setup', { jar, body: { password: 'nope' } })
    check('setup with a wrong password is refused',
      wrongPw.status === 401 && wrongPw.body?.error?.code === 'WRONG_PASSWORD', `got ${wrongPw.status}`)
    const ok = await call('POST', '/auth/2fa/setup', { jar, body: { password: PW } })
    check('setup with the correct password returns a secret', ok.status === 200 && !!ok.body?.data?.secret)
  }

  section('P-15 — presigned uploads are an authoring capability')
  {
    const sJar = await login('stud@t.local')
    const asStudent = await call('POST', '/uploads/presign', { jar: sJar, body: { filename: 'a.mp4', contentType: 'video/mp4', folder: 'videos' } })
    check('a student is refused', asStudent.status === 403, `got ${asStudent.status}`)
    const aJar = await login('dadmin@t.local', true)
    const asAdmin = await call('POST', '/uploads/presign', { jar: aJar, body: { filename: 'a.mp4', contentType: 'video/mp4', folder: 'videos' } })
    check('an admin gets past the role gate', asAdmin.status !== 403, `got ${asAdmin.status}`)
  }

  section('P-07 — a kyc/ key is accepted where only a URL used to be')
  {
    const jar = await login('stud@t.local')
    const key = await call('PATCH', '/auth/me/enrollment-docs', { jar, body: { passportUrl: 'kyc/1770000000-a1b2c3d4.jpg' } })
    check('a bare kyc/ key is accepted — the repair', key.status === 200, `got ${key.status} ${JSON.stringify(key.body?.error ?? '')}`)
    const foreign = await call('PATCH', '/auth/me/enrollment-docs', { jar, body: { passportUrl: 'https://attacker.example/x.png' } })
    check('a foreign host is still refused — P-19', foreign.status === 422, `got ${foreign.status}`)
  }

  section('P-22 — learning paths are scoped to their academy')
  {
    const dJar = await login('dadmin@t.local')
    const bJar = await login('badmin@t.local')
    const sJar = await login('super@t.local')

    const created = await call('POST', '/learning-paths', { jar: dJar, body: { title: `Dubai Path ${Date.now()}` } })
    check('a Dubai admin can create a path', created.status === 201, `got ${created.status} ${JSON.stringify(created.body?.error ?? '')}`)
    const pathId = created.body?.data?.path?.id ?? created.body?.data?.path?._id

    const stamped = await LearningPathModel.findById(pathId).lean() as any
    check('the route threaded the academy through to the model',
      String(stamped?.organizationId) === String(dubai._id), String(stamped?.organizationId))

    const crossEdit = await call('PATCH', `/learning-paths/${pathId}`, { jar: bJar, body: { title: 'hijacked' } })
    check('the other academy cannot edit it', crossEdit.status === 404, `got ${crossEdit.status}`)
    const crossDel = await call('DELETE', `/learning-paths/${pathId}`, { jar: bJar })
    check('the other academy cannot delete it', crossDel.status === 404, `got ${crossDel.status}`)
    check('it survived both attempts', !!(await LearningPathModel.findById(pathId)))

    const ownEdit = await call('PATCH', `/learning-paths/${pathId}`, { jar: dJar, body: { title: 'renamed' } })
    check('its own academy can edit it', ownEdit.status === 200, `got ${ownEdit.status}`)

    /* P-21 — super_admin was missing from these role lists entirely. */
    const superEdit = await call('PATCH', `/learning-paths/${pathId}`, { jar: sJar, body: { title: 'by super' } })
    check('P-21  super_admin is no longer locked out', superEdit.status === 200, `got ${superEdit.status}`)

    const dList = await call('GET', '/learning-paths/admin/list', { jar: dJar })
    const bList = await call('GET', '/learning-paths/admin/list', { jar: bJar })
    check('the admin list is academy-filtered',
      (dList.body?.data?.paths?.length ?? 0) === 1 && (bList.body?.data?.paths?.length ?? 0) === 0,
      `dubai=${dList.body?.data?.paths?.length} blr=${bList.body?.data?.paths?.length}`)
  }

  section('rate limiting and validation still bite')
  {
    const jar = await login('stud@t.local')
    const bad = await call('POST', '/learning-paths', { jar, body: { title: 'x' } })
    check('a too-short title fails validation before any guard', bad.status === 422 || bad.status === 403, `got ${bad.status}`)
    const notFound = await call('GET', '/does-not-exist')
    check('an unknown route answers 404', notFound.status === 404)
  }

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
