/* ─────────────────────────────────────────────────────────────
   Does the Orders table actually record every gateway?

   The five checkout paths each write their own gateway and a real amount, and
   always did. The hole was the external-purchase integration, which hardcoded
   `gateway: 'razorpay'` whatever took the money and defaulted a missing amount
   to ZERO — so the whole table read "Razorpay ₹0.00" and every revenue figure
   built by summing that column was silently wrong.

   Zero is a CLAIM, not a safe default: it says the student paid nothing, which
   is a different statement from "the amount was not sent". Section B pins that.

   The other half is that one external purchase enrols the buyer in SEVERAL
   courses, each needing its own Order row because courseId is required. Writing
   the full amount on all of them turned one ₹5,000 purchase into ₹10,000 of
   reported revenue. Section C pins the attribution.

   Run: bun run test:ordergateways
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_ordergateways'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

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
const { UserModel, CourseModel, OrganizationModel, OrderModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_ordergateways') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@og.local`

try {
  const dubai = await OrganizationModel.create({
    name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const blr = await OrganizationModel.create({
    name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  const root = await UserModel.create({
    name: 'Root', email: email('root'), passwordHash: hash, role: 'super_admin', isActive: true,
  })
  const dubaiAdm = await UserModel.create({
    name: 'DubaiAdmin', email: email('dubai'), passwordHash: hash, role: 'admin',
    isActive: true, organizationId: dubai._id,
  })
  const teacher = await UserModel.create({
    name: 'T', email: email('t'), passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: blr._id,
  })
  const buyer = await UserModel.create({
    name: 'Buyer', email: email('buyer'), passwordHash: hash, role: 'student',
    isActive: true, organizationId: dubai._id,
  })

  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email: e, password: PW } })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const rootJar  = await login(root.email)
  const dubaiJar = await login(dubaiAdm.email)

  /* The two courses one external purchase enrols into. Prices differ so an
     implementation that silently uses "a" price can be told from one that uses
     the RIGHT price. */
  const mkCourse = (slug: string, price: number, org: any) => CourseModel.create({
    title: slug, slug, description: 'd', instructorId: teacher._id,
    price, isFree: false, status: 'published', language: 'English', organizationId: org._id,
  })
  await mkCourse('ai', 4000, blr)
  await mkCourse('ai-academy-english', 7000, blr)

  const { OrderService } = await import('@/services/order.service.ts')
  const svc = new OrderService()

  const ordersFor = (orderId: string) =>
    OrderModel.find({ razorpayOrderId: orderId }).sort({ amount: -1 }).lean()

  /* ═══════════════════════════════════════════════ */
  section('A · the gateway that took the money is the one recorded')
  {
    const ext = `ext-abzer-${Date.now()}`
    await svc.provisionExternalPurchase({
      email: email('abzer-buyer'), name: 'Abzer Buyer',
      orderId: ext, amount: 5000, currency: 'AED', gateway: 'abzer',
    })
    const rows = await ordersFor(ext) as any[]
    check('the purchase produced orders', rows.length === 2, String(rows.length))
    check('and BOTH say abzer — not the hardcoded razorpay',
      rows.every(r => r.gateway === 'abzer'), rows.map(r => r.gateway).join(','))

    /* Callers written before the field existed must keep working. */
    const legacy = `ext-legacy-${Date.now()}`
    await svc.provisionExternalPurchase({
      email: email('legacy-buyer'), orderId: legacy, amount: 100, currency: 'INR',
    })
    const old = await ordersFor(legacy) as any[]
    check('a caller that names no gateway still records razorpay, as before',
      old.every(r => r.gateway === 'razorpay'), old.map(r => r.gateway).join(','))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · a missing amount is not recorded as a payment of zero')
  {
    const ext = `ext-noamount-${Date.now()}`
    await svc.provisionExternalPurchase({
      email: email('silent'), orderId: ext, currency: 'INR',
    })
    const rows = await ordersFor(ext) as any[]
    const total = rows.reduce((t, r) => t + (r.amount ?? 0), 0)

    check('two orders were still written', rows.length === 2, String(rows.length))
    check('the purchase is NOT recorded as ₹0 — the old behaviour', total > 0, String(total))
    /* The best available truth when the caller says nothing: the course's own
       price. Asserting the VALUE, not merely "non-zero", so a fallback that
       invents a number would fail here too. */
    check('it falls back to the course price', total === 4000 || total === 7000, String(total))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · one payment is counted once, not once per course')
  {
    const ext = `ext-split-${Date.now()}`
    await svc.provisionExternalPurchase({
      email: email('splitter'), orderId: ext, amount: 5000, currency: 'INR', gateway: 'razorpay',
    })
    const rows = await ordersFor(ext) as any[]
    check('both courses got a row — every enrolment stays traceable',
      rows.length === 2, String(rows.length))
    check('but the money is counted ONCE, not doubled',
      rows.reduce((t, r) => t + r.amount, 0) === 5000,
      String(rows.reduce((t, r) => t + r.amount, 0)))
    check('the full amount sits on one row', rows[0]?.amount === 5000, String(rows[0]?.amount))
    check('and the other carries zero', rows[1]?.amount === 0, String(rows[1]?.amount))
    check('while both still point at the same external purchase',
      rows.every(r => r.razorpayOrderId === ext))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · re-running the same external purchase changes nothing')
  {
    const ext = `ext-idem-${Date.now()}`
    await svc.provisionExternalPurchase({
      email: email('idem'), orderId: ext, amount: 900, currency: 'INR', gateway: 'razorpay',
    })
    const first = (await ordersFor(ext)).length
    const again = await svc.provisionExternalPurchase({
      email: email('idem'), orderId: ext, amount: 900, currency: 'INR', gateway: 'razorpay',
    })
    check('a webhook retry reports it was already done', again.alreadyProcessed === true)
    check('and writes no second set of orders',
      (await ordersFor(ext)).length === first, String((await ordersFor(ext)).length))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · the breakdown shows every gateway that has recorded anything')
  {
    /* Rows the checkout paths would have produced, written directly — the point
       under test is the reporting, not the five checkout flows. */
    const anyCourse = await CourseModel.findOne({ slug: 'ai' }).lean() as any
    for (const [gw, status, amount] of [
      ['stripe', 'paid',      2500],
      ['tabby',  'paid',      1200],
      ['tabby',  'pending',    800],
      ['tamara', 'refunded',   400],
    ] as const) {
      await OrderModel.create({
        userId: buyer._id, courseId: anyCourse._id, organizationId: dubai._id,
        gateway: gw, status, amount, currency: 'aed',
      })
    }

    const r = await call('GET', '/admin/orders/by-gateway', { jar: rootJar })
    check('the breakdown answers', r.status === 200, String(r.status))

    const by = new Map((r.body?.data ?? []).map((x: any) => [x.gateway, x]))
    check('abzer is listed — the whole question this screen exists for',
      by.has('abzer'), [...by.keys()].join(','))
    check('so are stripe, tabby, tamara and razorpay',
      ['stripe', 'tabby', 'tamara', 'razorpay'].every(g => by.has(g)), [...by.keys()].join(','))

    const tabby = by.get('tabby') as any
    check('a gateway with mixed statuses reports each', tabby?.paid === 1 && tabby?.pending === 1,
      `paid=${tabby?.paid} pending=${tabby?.pending}`)
    check('and only SETTLED money is summed — a pending row is an intention',
      tabby?.paidAmount === 1200, String(tabby?.paidAmount))

    const tamara = by.get('tamara') as any
    check('a refunded order counts as a row but not as revenue',
      tamara?.total === 1 && tamara?.paidAmount === 0,
      `total=${tamara?.total} paid=${tamara?.paidAmount}`)

    /* Every figure must survive a direct recount. */
    let bad = ''
    for (const [gw, row] of by) {
      const real = await OrderModel.countDocuments({ gateway: gw })
      if (real !== (row as any).total) bad += `${gw}: shown ${(row as any).total}, real ${real}; `
    }
    check('every row matches a direct count', bad === '', bad)
  }

  /* ═══════════════════════════════════════════════ */
  section('F · the filter narrows the list to one gateway')
  {
    const all = await call('GET', '/admin/orders?per_page=100', { jar: rootJar })
    const one = await call('GET', '/admin/orders?per_page=100&gateway=tabby', { jar: rootJar })
    check('filtering answers', one.status === 200, String(one.status))
    check('and returns only that gateway',
      (one.body?.data ?? []).every((o: any) => o.gateway === 'tabby'),
      [...new Set((one.body?.data ?? []).map((o: any) => o.gateway))].join(','))
    check('which is fewer rows than the unfiltered list',
      (one.body?.data ?? []).length < (all.body?.data ?? []).length,
      `${(one.body?.data ?? []).length} vs ${(all.body?.data ?? []).length}`)

    /* An unknown gateway must be refused at the edge. Matching nothing would
       read as "this gateway has recorded no orders" — the exact wrong answer
       for a screen whose job is telling you whether a gateway is recording. */
    const bogus = await call('GET', '/admin/orders?gateway=not-a-gateway', { jar: rootJar })
    check('an unknown gateway is REFUSED, not silently empty',
      bogus.status === 422 || bogus.status === 400, String(bogus.status))

    const both = await call('GET', '/admin/orders?per_page=100&gateway=tabby&status=paid', { jar: rootJar })
    check('gateway and status compose', (both.body?.data ?? []).length === 1,
      String((both.body?.data ?? []).length))
  }

  /* ═══════════════════════════════════════════════ */
  section('G · academies do not see each other')
  {
    const r = await call('GET', '/admin/orders/by-gateway', { jar: dubaiJar })
    check('a scoped admin gets a breakdown', r.status === 200, String(r.status))
    const gateways = (r.body?.data ?? []).map((x: any) => x.gateway)
    check('and it excludes the Bangalore-only external purchases',
      !gateways.includes('razorpay'), gateways.join(','))
    check('while still showing their own', gateways.includes('tabby'), gateways.join(','))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
