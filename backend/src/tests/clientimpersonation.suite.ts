/* ─────────────────────────────────────────────────────────────
   Client-portal impersonation — a super admin browses the student
   app as a student, read-only.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_clientimp_suite), dropped on exit. The real `lms` database is
   never opened.

   Four properties are worth proving, because each one is a thing that
   would be silently wrong if it regressed:
     1. audience separation — the admin-side token must NOT work on a
        client route, or the two portals collapse back into one (L-06)
     2. the handoff code is single-use and short-lived
     3. the session is READ-ONLY — writes would be attributed to the student
     4. the admin's own `lms_at` session survives, because the impersonation
        rides a separate cookie

   Run: bun run test:clientimp
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_clientimp_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'

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
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, ImpersonationHandoffModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_clientimp_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) {
      const name = pair!.slice(0, i), value = pair!.slice(i + 1)
      /* An expiry in the past IS a deletion — modelling it as one is what makes
         the "exit clears the cookie" assertion mean anything. */
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name)
      else jar.set(name, value)
    }
  }
}
async function call(method: string, path: string, opts: { jar?: Jar; bearer?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) absorb(opts.jar, res)
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string) =>
    UserModel.create({
      name: email, email, passwordHash: hash, role, isActive: true,
      organizationId: org._id,
      ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}),
    })

  await mk('super@t.local', 'super_admin')
  await mk('plainadmin@t.local', 'admin')
  const student = await mk('student@t.local', 'student')
  const staff   = await mk('mentor@t.local', 'instructor')

  /* The super admin's ADMIN session (lms_admin_at). */
  const adminJar: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', { jar: adminJar, body: { email: 'super@t.local', password: PW } })
  if (li.status !== 200) throw new Error(`super_admin login failed: ${li.status}`)

  section('creating the handoff')
  const created = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
  check('super_admin can create a client handoff', created.status === 200, `got ${created.status}`)
  const code = created.body?.data?.code
  check('a one-time code is returned', typeof code === 'string' && code.length === 64, `len ${code?.length}`)
  check('the response carries a client URL to open',
    typeof created.body?.data?.clientUrl === 'string' && created.body.data.clientUrl.includes('/imp/enter?code='),
    created.body?.data?.clientUrl)
  check('no token is handed to the admin app',
    created.body?.data?.token === undefined,
    'a client token in the admin app is exactly what the handoff exists to avoid')

  const stored = await ImpersonationHandoffModel.findOne({}).lean() as any
  check('the raw code is NOT stored — only its hash',
    !!stored && stored.codeHash !== code && stored.codeHash?.length === 64)

  section('who may create one')
  const otherJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: otherJar, body: { email: 'plainadmin@t.local', password: PW } })
  const byAdmin = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: otherJar })
  check('a plain admin cannot — super_admin only', byAdmin.status === 403, `got ${byAdmin.status}`)

  const onStaff = await call('POST', `/admin/users/${staff._id}/impersonate-client`, { jar: adminJar })
  check('non-students are refused', onStaff.status === 400, `got ${onStaff.status}`)

  section('redeeming on the client origin')
  const bad = await call('POST', '/auth/impersonation/redeem', { body: { code: 'tooshort' } })
  check('a malformed code is refused', bad.status === 400, `got ${bad.status}`)

  /* A pre-existing CLIENT session for the same browser — the thing that must
     survive redemption. Logging in as the student is the simplest way to get a
     real lms_at into the jar. */
  const browser: Jar = new Map()
  const studentLogin = await call('POST', '/auth/login', { jar: browser, body: { email: 'student@t.local', password: PW } })
  check('a real client session exists first (lms_at present)',
    studentLogin.status === 200 && browser.has('lms_at'), `got ${studentLogin.status}`)
  const originalAt = browser.get('lms_at')

  const redeemed = await call('POST', '/auth/impersonation/redeem', { jar: browser, body: { code } })
  check('the code redeems', redeemed.status === 200, `got ${redeemed.status} ${JSON.stringify(redeemed.body?.error ?? '')}`)
  check('an lms_imp_at cookie is set', browser.has('lms_imp_at'))
  check('a readable lms_imp flag rides alongside it',
    browser.get('lms_imp') === '1',
    'the banner needs this to avoid probing /auth/me on public pages')
  check('the pre-existing lms_at is UNTOUCHED — the admin keeps their own session',
    browser.get('lms_at') === originalAt)

  section('single use')
  const again = await call('POST', '/auth/impersonation/redeem', { body: { code } })
  check('the same code cannot be redeemed twice', again.status === 410, `got ${again.status}`)

  section('the session acts as the STUDENT on client routes')
  const me = await call('GET', '/auth/me', { jar: browser })
  check('a client route authenticates', me.status === 200, `got ${me.status}`)
  check('it acts as the impersonated student',
    me.body?.data?.email === 'student@t.local' || me.body?.data?.user?.email === 'student@t.local',
    JSON.stringify(me.body?.data?.email ?? me.body?.data?.user?.email))

  check('/auth/me reports the impersonation, so the banner can exist',
    me.body?.data?.impersonation?.readOnly === true
    && me.body?.data?.impersonation?.actorEmail === 'super@t.local',
    JSON.stringify(me.body?.data?.impersonation))

  section('READ-ONLY')
  const write = await call('PATCH', '/auth/me', { jar: browser, body: { name: 'Renamed By Admin' } })
  check('a write is refused',
    write.status === 403 && write.body?.error?.code === 'IMPERSONATION_READ_ONLY',
    `got ${write.status} ${write.body?.error?.code}`)
  const fresh = await UserModel.findById(student._id).select('name').lean() as any
  check('the student record really was not modified', fresh?.name === 'student@t.local', fresh?.name)

  section('audience separation (L-06)')
  const adminSide = await call('POST', `/admin/users/${student._id}/impersonate`, { jar: adminJar })
  const adminToken = adminSide.body?.data?.token
  check('the admin-side flow still issues a token', !!adminToken)
  const crossed = await call('GET', '/auth/me', { bearer: adminToken })
  check('an admin-audience token is REJECTED on a client route',
    crossed.status === 401, `got ${crossed.status} — the portals must not share tokens`)

  section('revocation reaches the client session')
  const impId = created.body?.data?.impersonationId
  const rev = await call('DELETE', `/admin/impersonation-sessions/${impId}`, { jar: adminJar })
  check('the session can be ended from the admin panel', rev.status === 200, `got ${rev.status}`)
  const afterRevoke = await call('GET', '/auth/me', { jar: browser })
  check('the client session dies immediately',
    afterRevoke.status === 401 && afterRevoke.body?.error?.code === 'IMPERSONATION_REVOKED',
    `got ${afterRevoke.status} ${afterRevoke.body?.error?.code}`)

  section('exit')
  const exited = await call('POST', '/auth/impersonation/exit', { jar: browser })
  check('exit responds', exited.status === 200, `got ${exited.status}`)
  check('the impersonation cookie is gone', !browser.has('lms_imp_at'))
  check('and so is the flag, so the banner stops rendering', !browser.has('lms_imp'))
  const backToSelf = await call('GET', '/auth/me', { jar: browser })
  check('the ORIGINAL session is live again — nothing was destroyed',
    backToSelf.status === 200, `got ${backToSelf.status}`)
  check('and it reports NO impersonation, so the banner disappears',
    backToSelf.body?.data?.impersonation === undefined,
    JSON.stringify(backToSelf.body?.data?.impersonation))
  const writeAsSelf = await call('PATCH', '/auth/me', { jar: browser, body: { name: 'Student Renamed Themselves' } })
  check('writes work again once impersonation is over',
    writeAsSelf.status === 200, `got ${writeAsSelf.status}`)

  section('expiry')
  const c2 = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
  await ImpersonationHandoffModel.updateOne(
    { codeHash: { $exists: true }, usedAt: { $exists: false } },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  )
  const expired = await call('POST', '/auth/impersonation/redeem', { body: { code: c2.body?.data?.code } })
  check('an expired code is refused', expired.status === 410, `got ${expired.status}`)

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
