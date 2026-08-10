/* ─────────────────────────────────────────────────────────────
   B-01 … B-05 — the 2026-08-08 bug-bounty findings.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_bounty_suite), dropped on exit. The real `lms` database is never opened.

   B-01 is the one that costs money, and phase A is written to fail loudly if
   it ever regresses: `priceAED` and `priceINR` were accepted by the admin
   form, accepted by the API's Zod schema, read in seven places by the checkout
   code — and declared in no schema, so Mongoose dropped them on every save.
   Every non-USD order fell back to a conversion rate. Typing 999 into the INR
   field produced a charge of 8,300.

   The property that matters is NOT "the fields exist". It is that a stored
   override is what the gateway charges, AND that a course without one still
   falls back exactly as it did before — because every course in production
   today is in that second state, and repricing them silently would be a worse
   bug than the one being fixed.

   Run: bun run test:bounty
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_bounty_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '200'
/* Deliberately NOT the defaults (83 / 3.67). A mutation that hardcodes the old
   literal back into order.service.ts is invisible against a default value —
   the first version of this suite missed exactly that. */
process.env.INR_EXCHANGE_RATE = '90'
process.env.UAE_EXCHANGE_RATE = '4.10'
delete process.env.CHECKOUT_BLOCK_REJECTED

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
const { UserModel, OrganizationModel, CourseModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { env } = await import('@/config/env.ts')
const { inrPriceFor, aedPriceFor } = await import('@/services/order.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_bounty_suite') {
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

const PW = 'CorrectHorse1'

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)
  const mk = (email: string, role: string, org: unknown, extra: object = {}) =>
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true, organizationId: org, ...extra })

  const dubaiTeacher = await mk('teach.dxb@t.local', 'instructor', dubai._id)
  const blrTeacher   = await mk('teach.blr@t.local', 'instructor', blr._id)
  const goneTeacher  = await mk('teach.off@t.local', 'instructor', dubai._id, { isActive: false })
  await mk('admin.dxb@t.local', 'admin', dubai._id)
  await mk('root@t.local', 'super_admin', dubai._id)

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`)
    return jar
  }
  const adminJar = await login('admin.dxb@t.local')

  const makeCourse = (over: object = {}) => ({
    title: 'Pricing course', slug: `price-${Date.now()}-${Math.floor(performance.now() * 1000) % 100000}`,
    description: 'A course long enough to satisfy the minimum description length rule.',
    price: 100, isFree: false, status: 'published', language: 'English', ...over,
  })

  section('B-01 — per-currency prices are stored, and drive what the gateway charges')
  {
    const created = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse({ priceAED: 350, priceINR: 999 }) })
    check('a course with both overrides is created', created.status === 201,
      `got ${created.status} ${JSON.stringify(created.body?.error ?? '')}`)

    const id = created.body?.data?.id
    const raw: any = await CourseModel.findById(id).lean()
    check('priceAED is PERSISTED (it was silently dropped before)', raw?.priceAED === 350, String(raw?.priceAED))
    check('priceINR is PERSISTED', raw?.priceINR === 999, String(raw?.priceINR))

    /* The bug in the terms it was found in: what does checkout now charge? */
    const inrCharged = inrPriceFor(raw)
    const aedCharged = aedPriceFor(raw)
    check('admin types INR 999 → Razorpay charges 999, not 8300', inrCharged === 999, String(inrCharged))
    check('admin types AED 350 → the AED gateways charge 350, not 367', aedCharged === 350, String(aedCharged))

    check('the API reads them back, so the form round-trips',
      created.body?.data?.priceAED === 350 && created.body?.data?.priceINR === 999,
      JSON.stringify({ a: created.body?.data?.priceAED, i: created.body?.data?.priceINR }))
  }

  section('B-01b — a course WITHOUT overrides still falls back  ← every existing course')
  {
    const created = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse() })
    const raw: any = await CourseModel.findById(created.body?.data?.id).lean()
    check('no override is invented', raw?.priceAED === undefined && raw?.priceINR === undefined,
      JSON.stringify({ a: raw?.priceAED, i: raw?.priceINR }))
    check('it still converts, exactly as before the fix',
      inrPriceFor(raw) === Math.round(100 * env.INR_EXCHANGE_RATE), String(inrPriceFor(raw)))
    /* The rate is CONFIGURED, not a literal. This suite runs at 90, so a
       hardcoded 83 in order.service.ts produces 8300 where 9000 is required. */
    check('the INR conversion honours INR_EXCHANGE_RATE rather than a hardcoded 83',
      env.INR_EXCHANGE_RATE === 90 && inrPriceFor({ price: 100 }) === 9000,
      `rate=${env.INR_EXCHANGE_RATE} price=${inrPriceFor({ price: 100 })}`)
    check('the AED conversion honours UAE_EXCHANGE_RATE',
      aedPriceFor({ price: 100 }) === 410, String(aedPriceFor({ price: 100 })))
    check('an override still wins over the configured rate',
      inrPriceFor({ price: 100, priceINR: 999 }) === 999 && aedPriceFor({ price: 100, priceAED: 350 }) === 350)
  }

  section('B-01c — the overrides survive an edit, and clear with isFree')
  {
    const created = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse({ priceINR: 1499 }) })
    const id = created.body?.data?.id
    const patched = await call('PATCH', `/admin/courses/${id}`, { jar: adminJar, body: { priceINR: 2499, priceAED: 199 } })
    check('an edit updates them', patched.status === 200, `got ${patched.status}`)
    const raw: any = await CourseModel.findById(id).lean()
    check('...and the new values are stored', raw?.priceINR === 2499 && raw?.priceAED === 199,
      JSON.stringify({ i: raw?.priceINR, a: raw?.priceAED }))

    await call('PATCH', `/admin/courses/${id}`, { jar: adminJar, body: { isFree: true, price: 0 } })
    const free: any = await CourseModel.findById(id).lean()
    check('marking a course free clears the overrides, so a "free" course cannot still bill',
      free?.priceINR === undefined && free?.priceAED === undefined,
      JSON.stringify({ i: free?.priceINR, a: free?.priceAED }))
  }

  section('B-06 — clearing a field actually clears it  ← found while fixing B-01')
  {
    /* `$set: { field: undefined }` is a silent no-op in Mongoose, and the
       service wrote exactly that in five places on the assumption it cleared
       the field. So "remove this course's level" appeared to work and changed
       nothing. The repository now splits undefined out into $unset. */
    const created = await call('POST', '/admin/courses', {
      jar: adminJar, body: makeCourse({ level: 'beginner', program: 'ai' }),
    })
    const id = created.body?.data?.id
    const before: any = await CourseModel.findById(id).lean()
    check('the course starts with a level set', before?.level === 'beginner', String(before?.level))

    const cleared = await call('PATCH', `/admin/courses/${id}`, { jar: adminJar, body: { level: '' } })
    check('clearing it is accepted', cleared.status === 200, `got ${cleared.status}`)
    const after: any = await CourseModel.findById(id).lean()
    check('...and the level is really gone from the document',
      after?.level === undefined, String(after?.level))
    check('...while the fields that were not touched survive',
      after?.program === 'ai' && after?.title === before?.title,
      JSON.stringify({ p: after?.program }))
  }

  section('B-04 — a course cannot be credited to another academy\'s instructor')
  {
    const cross = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse({ instructorId: String(blrTeacher._id) }) })
    check('assigning the other academy\'s instructor is refused',
      cross.status === 403 && cross.body?.error?.code === 'INSTRUCTOR_OTHER_ORG',
      `got ${cross.status} ${cross.body?.error?.code}`)

    const own = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse({ instructorId: String(dubaiTeacher._id) }) })
    check('assigning an instructor from the SAME academy still works', own.status === 201, `got ${own.status}`)

    const ghost = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse({ instructorId: '6a3b025f3ed846a266200f42' }) })
    check('an instructor id that does not exist is refused',
      ghost.status === 404 && ghost.body?.error?.code === 'INSTRUCTOR_NOT_FOUND',
      `got ${ghost.status} ${ghost.body?.error?.code}`)

    const disabled = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse({ instructorId: String(goneTeacher._id) }) })
    check('a disabled account cannot be handed a course',
      disabled.status === 400 && disabled.body?.error?.code === 'INSTRUCTOR_INACTIVE',
      `got ${disabled.status} ${disabled.body?.error?.code}`)

    const bad = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse({ instructorId: 'not-an-id' }) })
    check('a malformed instructor id is refused', bad.status === 400, `got ${bad.status}`)

    /* And the same guard on edit — the original finding covered both paths. */
    const base = await call('POST', '/admin/courses', { jar: adminJar, body: makeCourse() })
    const reassign = await call('PATCH', `/admin/courses/${base.body?.data?.id}`, {
      jar: adminJar, body: { instructorId: String(blrTeacher._id) },
    })
    check('re-assigning an existing course across academies is refused too',
      reassign.status === 403, `got ${reassign.status}`)
  }

  section('B-04b — super_admin stays unscoped, matching every other tenancy guard')
  {
    const rootJar = await login('root@t.local')
    const r = await call('POST', '/admin/courses', {
      jar: rootJar,
      headers: { 'x-organization-id': String(dubai._id) },
      body: makeCourse({ instructorId: String(blrTeacher._id) }),
    })
    check('super_admin may still assign across academies', r.status === 201, `got ${r.status} ${r.body?.error?.code}`)
  }

  section('B-05 — the org-switch header is validated instead of reaching a query')
  {
    const rootJar = await login('root@t.local')
    const bad = await call('GET', '/admin/courses', { jar: rootJar, headers: { 'x-organization-id': 'not-an-objectid' } })
    check('a malformed X-Organization-Id is a 400, not a 500',
      bad.status === 400 && bad.body?.error?.code === 'INVALID_ORGANIZATION',
      `got ${bad.status} ${bad.body?.error?.code}`)

    const good = await call('GET', '/admin/courses', { jar: rootJar, headers: { 'x-organization-id': String(dubai._id) } })
    check('a valid one still selects that academy', good.status === 200, `got ${good.status}`)

    const none = await call('GET', '/admin/courses', { jar: rootJar })
    check('omitting it still means "all academies"', none.status === 200, `got ${none.status}`)
  }

  section('B-03 — all five checkout routes agree')
  {
    const course = await CourseModel.findOne({ isFree: false, priceINR: 999 }).lean()
    const courseId = String((course as any)?._id ?? '')

    const mkStudent = async (email: string, status: string) => {
      await UserModel.create({
        name: email, email, passwordHash: hash, role: 'student', isActive: true,
        organizationId: dubai._id, enrollmentStatus: status,
      })
      const jar: Jar = new Map()
      const r = await call('POST', '/auth/login', { jar, body: { email, password: PW } })
      if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`)
      return jar
    }

    const ROUTES = [
      '/checkout/',
      '/checkout/razorpay/create-order',
      '/checkout/tabby/create-order',
      '/checkout/abzer/create-order',
      '/checkout/tamara/create-order',
    ]

    /* A pending applicant is the pay-to-enrol flow. No route may answer
       PENDING_APPROVAL — that was the Stripe-only behaviour that made the five
       disagree. Gateways that are unconfigured answer 503, which is a
       different thing and fine. */
    const pendingJar = await mkStudent(`pend-${Date.now()}@t.local`, 'pending')
    for (const route of ROUTES) {
      const r = await call('POST', route, { jar: pendingJar, body: { courseId } })
      check(`${route} does not refuse a PENDING applicant`,
        r.body?.error?.code !== 'PENDING_APPROVAL' && r.body?.error?.code !== 'ACCESS_REJECTED',
        `got ${r.status} ${r.body?.error?.code}`)
    }

    /* Default: a rejected applicant is treated exactly as the four majority
       routes always treated them — allowed, because payment auto-approves. */
    const rejectedJar = await mkStudent(`rej-${Date.now()}@t.local`, 'rejected')
    const beforeFlag = await call('POST', '/checkout/razorpay/create-order', { jar: rejectedJar, body: { courseId } })
    check('by default a rejected applicant is NOT blocked (unchanged behaviour)',
      beforeFlag.body?.error?.code !== 'ACCESS_REJECTED', `got ${beforeFlag.body?.error?.code}`)

    /* And the switch makes a rejection final, on every route at once. */
    process.env.CHECKOUT_BLOCK_REJECTED = 'true'
    for (const route of ROUTES) {
      const r = await call('POST', route, { jar: rejectedJar, body: { courseId } })
      check(`CHECKOUT_BLOCK_REJECTED: ${route} refuses a rejected applicant`,
        r.status === 403 && r.body?.error?.code === 'ACCESS_REJECTED',
        `got ${r.status} ${r.body?.error?.code}`)
    }
    const stillPending = await call('POST', '/checkout/razorpay/create-order', { jar: pendingJar, body: { courseId } })
    check('...while a PENDING applicant is still allowed through',
      stillPending.body?.error?.code !== 'ACCESS_REJECTED', `got ${stillPending.body?.error?.code}`)
    delete process.env.CHECKOUT_BLOCK_REJECTED
  }

} finally {
  delete process.env.CHECKOUT_BLOCK_REJECTED
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
