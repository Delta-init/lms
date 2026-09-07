/* ─────────────────────────────────────────────────────────────
   Course.enrolledCount — the student number the admin table shows.

   It is a denormalised counter, and it was being maintained on two of the
   five paths that create an enrolment and on NONE of the three that remove
   one. So it could only ever climb, and only for some enrolments: locally 18
   of 19 courses disagreed with the enrolments that actually existed, and any
   course from scripts/seed.ts carried `Math.random() * 3000`.

   Two separate guarantees are worth pinning, because they fail differently:

     A. the ADMIN LIST reports a true count — derived, so it cannot drift
        however badly the stored field is wrong;
     B. the STORED counter tracks creates AND deletes on every path, so the
        public catalogue (which sorts by it) stops telling stories.

   A is the safety net; B is the repair. Test both — if only B is covered, a
   new enrolment path silently reintroduces the bug; if only A is covered, the
   catalogue keeps lying.

   Run: bun run test:enrolledcount
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_enrolledcount'
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
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
const app = (await import('@/app.ts')).default
const {
  UserModel, CourseModel, EnrollmentModel, OrganizationModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_enrolledcount') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const idx = pair!.indexOf('=')
    if (idx > 0 && opts.jar) opts.jar.set(pair!.slice(0, idx), pair!.slice(idx + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const storedCount = async (courseId: unknown): Promise<number> =>
  ((await CourseModel.findById(courseId).select('enrolledCount').lean()) as
    { enrolledCount?: number } | null)?.enrolledCount ?? 0

const PW = 'CorrectHorse1'

try {
  const org = await OrganizationModel.create({
    name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  const admin = await UserModel.create({
    name: 'A', email: 'a@ec.local', passwordHash: hash, role: 'super_admin',
    isActive: true, organizationId: org._id,
  })
  const teacher = await UserModel.create({
    name: 'T', email: 't@ec.local', passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })

  const mkCourse = (title: string, seeded = 0) => CourseModel.create({
    title, slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}${Math.random()}`,
    description: 'd', instructorId: teacher._id, price: 0, isFree: true,
    status: 'published', language: 'English', organizationId: org._id,
    enrolledCount: seeded,
  })

  const aJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: aJar, body: { email: 'a@ec.local', password: PW } })

  /* ═══════════════════════════════════════════════ */
  section('A · the admin list reports a TRUE count, whatever the stored field says')
  {
    /* A course whose stored counter is pure fiction — exactly what
       scripts/seed.ts produces with Math.random() * 3000. */
    const course = await mkCourse('Fiction Counter', 2999)
    const students = await Promise.all([0, 1, 2].map(i => UserModel.create({
      name: `S${i}`, email: `s${i}-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })))
    /* Written straight to the collection, the way the bulk-import scripts do:
       the counter is untouched and stays at 2999. */
    await EnrollmentModel.insertMany(students.map(s => ({
      userId: s._id, courseId: course._id, status: 'active',
    })))

    check('the stored counter is still the fiction it started as',
      await storedCount(course._id) === 2999)

    const res = await call('GET', '/admin/courses?per_page=100', { jar: aJar })
    const row = (res.body?.data ?? []).find((c: any) => c.title === 'Fiction Counter')
    check('the admin list finds the course', !!row, String(res.status))
    check('and reports 3 — the enrolments that exist, not the stored 2999',
      row?.enrolledCount === 3, `got ${row?.enrolledCount}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('B · the stored counter tracks admin enrol and un-enrol')
  {
    const course = await mkCourse('Counted Course')
    const student = await UserModel.create({
      name: 'S', email: `s-admin-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })

    check('a new course starts at zero', await storedCount(course._id) === 0)

    const enrolled = await call('POST', `/admin/users/${String(student._id)}/enrollments`, {
      jar: aJar, body: { courseId: String(course._id) },
    })
    check('an admin can enrol someone', enrolled.status === 201 || enrolled.status === 200,
      String(enrolled.status))
    check('and THAT path now increments — it never used to',
      await storedCount(course._id) === 1, `got ${await storedCount(course._id)}`)

    const row = await EnrollmentModel.findOne({ userId: student._id, courseId: course._id }).lean()
    const removed = await call('DELETE', `/admin/enrollments/${String((row as any)._id)}`, { jar: aJar })
    check('an admin can remove the enrolment', removed.status === 200, String(removed.status))
    check('and the counter comes back DOWN — nothing decremented it anywhere before',
      await storedCount(course._id) === 0, `got ${await storedCount(course._id)}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · deleting the account releases the seats it held')
  {
    const course = await mkCourse('Seat Release')
    const student = await UserModel.create({
      name: 'S', email: `s-del-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    await call('POST', `/admin/users/${String(student._id)}/enrollments`, {
      jar: aJar, body: { courseId: String(course._id) },
    })
    check('the seat is counted', await storedCount(course._id) === 1)

    const { AuthService } = await import('@/services/auth.service.ts')
    await new AuthService().deleteAccount(String(student._id), PW)

    check('and released when the account is deleted',
      await storedCount(course._id) === 0, `got ${await storedCount(course._id)}`)
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
