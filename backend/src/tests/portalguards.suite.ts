/* ─────────────────────────────────────────────────────────────
   PORTAL GUARDS — does every endpoint accept the cookie its caller has?

   The bug this exists to catch, in full:

     Two admin sections (Learning Paths, Audit Logs) were guarded by
     `authenticate`, which reads ONLY the client cookie `lms_at`. The admin
     panel carries `lms_admin_at`, so those calls could never succeed —
     they answered 401 MISSING_TOKEN every time.

     A 401 is indistinguishable from an expired session, so the axios
     interceptor did the reasonable thing: refresh, then retry. The retry
     401'd too, because expiry was never the problem. React Query retried,
     and each cycle rotated the refresh token. Eventually a refresh failed
     outright — and a failed refresh did not clear the cookies. That left a
     cookie that LOOKS signed-in to the Next middleware (which can only
     check presence) but is dead to the API (which checks validity). The two
     then chased each other: /login saw a cookie and redirected to the
     dashboard, the dashboard 401'd and redirected to /login. Every hop is a
     middleware redirect, so the browser reloaded itself forever and the
     sign-in form could not be reached without clearing cookies by hand.

   So this suite tests both halves:

     1. THE SWEEP. Every API path the two frontends actually call — scraped
        from their source into portalguards.endpoints.ts — is called with
        the cookie that portal really holds. Any MISSING_TOKEN is the
        signature of the bug: an endpoint whose guard reads the OTHER
        portal's cookie. 404/403/422 are all fine; the sweep is about which
        guard answered, not what the handler did.

     2. THE LOOP BREAKER. A refresh that definitively fails must clear the
        cookies, so presence and validity stop disagreeing.

   Two things keep the sweep honest:

     • A CONTROL. The same endpoints are called with NO cookie at all, and
       the run fails unless that produces a large crop of MISSING_TOKEN. A
       sweep that cannot observe the signature would report "all clear"
       whether or not the bug existed — which is exactly the trap this
       codebase keeps falling into.
     • A CANARY. One route deliberately mounted with the wrong guard is
       probed too, and the run fails if the sweep does not flag it.

   Runs against an ISOLATED throwaway database (lms_portalguards_suite),
   dropped on exit, so the write verbs in the list are harmless.

   Run: bun run test:portalguards
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_portalguards_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '2000'
process.env.RATE_LIMIT_API_MAX  = '20000'
process.env.SMTP_HOST  = ''
process.env.SMTP_USER  = ''
process.env.SMTP_PASS  = ''
process.env.EMAIL_FROM = ''

export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)

const { ENDPOINTS } = await import('./portalguards.endpoints.ts')
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_portalguards_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const PORT = (server.address() as { port: number }).port
const BASE = `http://127.0.0.1:${PORT}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown; raw?: boolean } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${opts.raw ? `http://127.0.0.1:${PORT}` : BASE}${p}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) for (const rawC of res.headers.getSetCookie?.() ?? []) {
    const [pair] = rawC.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body, setCookie: res.headers.getSetCookie?.() ?? [] }
}

const codeOf = (r: { body: any }) => String(r.body?.error?.code ?? '')
const PW = 'CorrectHorse1'

/** The signature of a portal mismatch: the guard wanted a cookie we do not carry. */
const MISMATCH = new Set(['MISSING_TOKEN', 'MISSING_REFRESH_TOKEN', 'NO_REFRESH_TOKEN'])

/* Endpoints the sweep must not CALL, because calling them destroys the very
   session the sweep depends on — the first version of this suite logged
   itself out halfway through and then reported 60-odd false mismatches for
   everything that came after.

   None of them is a candidate for the bug being hunted: each is a portal's
   own auth surface, reached before a session exists or in order to end one.
   The refresh pair is not skipped for convenience either — it gets a
   section of its own further down, with both the positive and negative
   case. */
const SKIP = new Set<string>([
  'POST /auth/login',            'POST /admin/auth/login',
  'POST /auth/login/2fa',        'POST /admin/auth/login/2fa',
  'POST /auth/register',
  'POST /auth/logout',           'POST /admin/auth/logout',
  'POST /auth/refresh',          'POST /admin/auth/refresh',
  'POST /auth/deactivate',
  'POST /auth/reset-password',
  'POST /auth/2fa/disable',
  'PATCH /auth/me/password',
  'DELETE /auth/account',
  'DELETE /auth/sessions/000000000000000000000000',
])

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  await UserModel.create({
    name: 'Sweep Admin', email: 'sweep.admin@t.local', passwordHash: hash,
    role: 'super_admin', isActive: true, isEmailVerified: true, organizationId: org._id,
  })
  await UserModel.create({
    name: 'Sweep Student', email: 'sweep.student@t.local', passwordHash: hash,
    role: 'student', isActive: true, isEmailVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id,
  })

  const adminJar: Jar  = new Map()
  const clientJar: Jar = new Map()
  const a = await call('POST', '/admin/auth/login', { jar: adminJar,  body: { email: 'sweep.admin@t.local',   password: PW } })
  const c = await call('POST', '/auth/login',       { jar: clientJar, body: { email: 'sweep.student@t.local', password: PW } })

  section('SESSIONS — one per portal, each holding its own cookie')
  check('the admin portal signs in',  a.status === 200, String(a.status))
  check('...and holds lms_admin_at',  [...adminJar.keys()].includes('lms_admin_at'), [...adminJar.keys()].join(','))
  check('the client portal signs in', c.status === 200, String(c.status))
  check('...and holds lms_at',        [...clientJar.keys()].includes('lms_at'), [...clientJar.keys()].join(','))
  check('...and the two jars share no cookie',
    ![...adminJar.keys()].some(k => clientJar.has(k)), 'jars overlap')

  /* ══════════ CONTROL ══════════
     Before trusting a clean sweep, prove the sweep can SEE the thing it is
     looking for. With no cookie at all, a large share of these endpoints
     must answer MISSING_TOKEN. If they do not, the probe is broken and
     every "no mismatch" result below would be meaningless. */
  section('CONTROL — the sweep can actually detect the signature')
  let anonMismatch = 0
  for (const e of ENDPOINTS) {
    const r = await call(e.verb, e.path, e.verb === 'GET' ? {} : { body: {} })
    if (MISMATCH.has(codeOf(r))) anonMismatch++
  }
  check(`an anonymous sweep raises the signature on many endpoints (${anonMismatch}/${ENDPOINTS.length})`,
    anonMismatch > ENDPOINTS.length / 3, `${anonMismatch} — too few to trust a clean run`)

  /* ══════════ CANARY ══════════
     A route mounted with the WRONG guard, probed exactly like the real ones.
     If the sweep logic ever stops flagging a mismatch, this fails first and
     says so plainly, rather than the suite quietly going green forever. */
  section('CANARY — a deliberately misguarded route is caught')
  {
    const express = (await import('express')).default
    const { authenticate } = await import('@/middleware/auth.middleware.ts')
    const canary = express()
    canary.get('/canary', authenticate, (_req, res) => { res.json({ success: true, data: 'reached' }) })
    const cs = canary.listen(0)
    await new Promise<void>(r => cs.once('listening', () => r()))
    const cport = (cs.address() as { port: number }).port
    const res = await fetch(`http://127.0.0.1:${cport}/canary`, {
      headers: { cookie: [...adminJar].map(([k, v]) => `${k}=${v}`).join('; ') },
    })
    const cbody: any = await res.json().catch(() => ({}))
    check('a client-cookie guard rejects the admin cookie with MISSING_TOKEN',
      MISMATCH.has(String(cbody?.error?.code)), JSON.stringify(cbody).slice(0, 90))
    cs.close()
  }

  /* ══════════ THE SWEEP ══════════ */
  section('SWEEP — every endpoint each portal calls, probed with that portal\'s cookie')
  const relogin = async (which: 'admin' | 'client') => {
    const jar = which === 'admin' ? adminJar : clientJar
    jar.clear()
    await call('POST', which === 'admin' ? '/admin/auth/login' : '/auth/login', {
      jar,
      body: { email: which === 'admin' ? 'sweep.admin@t.local' : 'sweep.student@t.local', password: PW },
    })
  }

  const mismatches: string[] = []
  const byApp = { admin: 0, client: 0 }
  let skipped = 0
  for (const e of ENDPOINTS) {
    const id  = `${e.verb} ${e.path}`
    const key = `${e.verb} ${e.path.replace(/0{24}/g, ':id')}`
    if (SKIP.has(id)) { skipped++; continue }

    const which = e.app as 'admin' | 'client'
    const jar   = which === 'admin' ? adminJar : clientJar
    const probe = () => call(e.verb, e.path, { jar, ...(e.verb === 'GET' ? {} : { body: {} }) })

    let r = await probe()
    byApp[which]++
    if (!MISMATCH.has(codeOf(r))) continue

    /* Before believing a mismatch, rule out collateral damage: an earlier
       probe in this run may have invalidated the session (a revoked token,
       an unforeseen side effect). Sign in fresh and ask again. Only a
       mismatch that survives a brand-new session is the real thing. */
    await relogin(which)
    r = await probe()
    if (!MISMATCH.has(codeOf(r))) continue

    mismatches.push(`${e.app.padEnd(6)} ${key}  →  ${codeOf(r)}   (${e.src})`)
  }
  lines.push(`  (probed ${byApp.admin + byApp.client}, skipped ${skipped} auth-lifecycle endpoints)`)
  check(`the admin portal reaches all ${byApp.admin} endpoints it calls without a cookie mismatch`,
    !mismatches.some(m => m.startsWith('admin')),
    mismatches.filter(m => m.startsWith('admin')).join(' | ').slice(0, 400))
  check(`the client portal reaches all ${byApp.client} endpoints it calls without a cookie mismatch`,
    !mismatches.some(m => m.startsWith('client')),
    mismatches.filter(m => m.startsWith('client')).join(' | ').slice(0, 400))

  if (mismatches.length) {
    lines.push('\n  ── endpoints answering with the wrong portal\'s guard ──')
    mismatches.forEach(m => lines.push(`     ${m}`))
  }

  /* Named checks for the two that started this, so a regression is obvious
     rather than buried in a count. */
  section('REGRESSION — the two sections that were reloading in production')
  {
    const lp = await call('GET', '/learning-paths/admin/list', { jar: adminJar })
    check('Learning Paths answers the admin panel', !MISMATCH.has(codeOf(lp)), `${lp.status} ${codeOf(lp)}`)
    check('...and it is not a 401 at all', lp.status !== 401, `${lp.status} ${codeOf(lp)}`)
    const al = await call('GET', '/audit-logs', { jar: adminJar })
    check('Audit Logs answers the admin panel', !MISMATCH.has(codeOf(al)), `${al.status} ${codeOf(al)}`)
    check('...and it is not a 401 at all', al.status !== 401, `${al.status} ${codeOf(al)}`)
  }

  /* ══════════ THE LOOP BREAKER ══════════ */
  section('LOOP BREAKER — a dead session must not leave a live-looking cookie')
  {
    const expiredOf = (setCookie: string[], name: string) =>
      setCookie.find(s => s.startsWith(`${name}=`)) ?? ''
    /* express clearCookie emits the name with an empty value and a past
       expiry — either marker proves the browser is told to drop it. */
    const clears = (setCookie: string[], name: string) => {
      const c = expiredOf(setCookie, name)
      if (!c) return false
      return /(^|;)\s*expires=/i.test(c) && (c.startsWith(`${name}=;`) || /Expires=Thu, 01 Jan 1970/i.test(c))
    }

    const withCookies = async (p: string, cookie: string) => {
      const res = await fetch(`${BASE}${p}`, {
        method: 'POST', ...(cookie ? { headers: { cookie } } : {}),
      })
      return { status: res.status, setCookie: res.headers.getSetCookie?.() ?? [] }
    }

    /* The stale state that actually loops: an access cookie still in the jar,
       its refresh token gone. This must be cleaned up. */
    const stale = await withCookies('/admin/auth/refresh', 'lms_admin_at=stale-but-present')
    check('a refresh carrying a stale access cookie is rejected', stale.status === 401, String(stale.status))
    check('...and tells the browser to drop lms_admin_at',
      clears(stale.setCookie, 'lms_admin_at'), stale.setCookie.join(' | ').slice(0, 160))

    const junk = await withCookies('/admin/auth/refresh', 'lms_admin_rt=not-a-real-token; lms_admin_at=stale')
    check('a refresh with an INVALID refresh token is rejected', junk.status === 401, String(junk.status))
    check('...and it too clears the access cookie',
      clears(junk.setCookie, 'lms_admin_at'), junk.setCookie.join(' | ').slice(0, 160))

    const cStale = await withCookies('/auth/refresh', 'lms_at=stale-but-present')
    check('the client refresh behaves the same way', cStale.status === 401, String(cStale.status))
    check('...clearing lms_at', clears(cStale.setCookie, 'lms_at'), cStale.setCookie.join(' | ').slice(0, 160))

    /* The client CATCH path, distinct from the early return above. Without
       this the client half of the fix could be deleted outright and every
       other check here would still pass — a mutation run proved exactly
       that, so the case earned its own probe. */
    const cJunk = await withCookies('/auth/refresh', 'lms_rt=not-a-real-token; lms_at=stale')
    check('a client refresh with an INVALID refresh token is rejected', cJunk.status === 401, String(cJunk.status))
    check('...and clears lms_at too', clears(cJunk.setCookie, 'lms_at'), cJunk.setCookie.join(' | ').slice(0, 160))

    /* ── The vector this must NOT open ──────────────────────────────────
       Cookies are SameSite=Lax and there is no CSRF layer, so a cross-site
       POST reaches this endpoint carrying NO cookies. If the endpoint
       answered that with a cookie-deleting Set-Cookie, any third-party page
       could sign a logged-in user out — SameSite decides whether a cookie is
       SENT, not whether a Set-Cookie is APPLIED. Clearing is therefore
       conditional on a cookie having been presented, and this is the check
       that keeps it that way. */
    const anon = await withCookies('/admin/auth/refresh', '')
    check('a refresh with NO cookies at all is still rejected', anon.status === 401, String(anon.status))
    check('...and clears nothing — no cross-site logout vector',
      !clears(anon.setCookie, 'lms_admin_at') && !clears(anon.setCookie, 'lms_admin_rt'),
      anon.setCookie.join(' | ').slice(0, 160))
    const cAnon = await withCookies('/auth/refresh', '')
    check('...and the client endpoint clears nothing either',
      !clears(cAnon.setCookie, 'lms_at') && !clears(cAnon.setCookie, 'lms_rt'),
      cAnon.setCookie.join(' | ').slice(0, 160))
    check('...while an unrelated cookie does not count as ours',
      !(await withCookies('/admin/auth/refresh', 'some_other_cookie=x')).setCookie.some(s => s.startsWith('lms_admin_at=;')))

    /* The negative twin: a HEALTHY session must never be cleared. Without
       this, "clear the cookies" could be implemented as "clear them always"
       and every check above would still pass while everyone got logged out. */
    const liveJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: liveJar, body: { email: 'sweep.admin@t.local', password: PW } })
    const good = await call('POST', '/admin/auth/refresh', { jar: liveJar })
    check('a VALID refresh still succeeds', good.status === 200, String(good.status))
    check('...and does NOT clear the session',
      !clears(good.setCookie, 'lms_admin_at'), good.setCookie.join(' | ').slice(0, 160))
    check('...it issues a fresh access cookie instead',
      good.setCookie.some(s => s.startsWith('lms_admin_at=') && !s.startsWith('lms_admin_at=;')))

    const stillWorks = await call('GET', '/admin/auth/me', { jar: liveJar })
    check('...and the refreshed session is usable', stillWorks.status === 200, String(stillWorks.status))

    /* ── A transient failure must NOT sign anybody out ──────────────────
       The clearing is deliberately gated on "AuthError carrying 401" — the
       service saying this token is genuinely invalid. A Mongo timeout, a
       limiter, or any unexpected throw is transient, and logging every
       admin out over a blip would be a worse outage than the loop being
       fixed here.

       Only reachable by making the service fail in a non-auth way, so the
       prototype is stubbed for exactly one call and restored immediately.
       Without this the gate could be widened to "clear on any error" and
       every other check in this section would still pass — a mutation run
       proved it. */
    const { AuthService } = await import('@/services/auth.service.ts')
    const realRefresh = AuthService.prototype.refresh
    AuthService.prototype.refresh = async () => { throw new Error('simulated database outage') }
    let blip: { status: number; setCookie: string[] }
    try {
      blip = await withCookies('/admin/auth/refresh', 'lms_admin_rt=some-token; lms_admin_at=live-session')
    } finally {
      AuthService.prototype.refresh = realRefresh
    }
    check('a NON-auth refresh failure is not treated as a dead session',
      blip.status >= 500, String(blip.status))
    check('...so the cookies are left alone — a blip must not log anyone out',
      !clears(blip.setCookie, 'lms_admin_at'), blip.setCookie.join(' | ').slice(0, 160))

    /* And the real session still works afterwards, proving the stub was
       undone rather than leaving the rest of the run in a broken state. */
    const afterBlip = await call('GET', '/admin/auth/me', { jar: liveJar })
    check('...and a genuine session is unaffected by all of the above',
      afterBlip.status === 200, String(afterBlip.status))
  }

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\n──── EVERY FAILURE ────')
  failures.forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${f}`))
}
process.exit(failures.length === 0 ? 0 : 1)
