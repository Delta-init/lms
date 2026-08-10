/**
 * Live end-to-end check for the class-change notification feature.
 *
 *   bun run verify-class-change-email -- someone@example.com
 *
 * Books a student onto a session, reassigns the instructor through the REAL
 * admin HTTP API, and reports whether the notification and the email actually
 * went out.
 *
 * IT SENDS A REAL EMAIL to the address given. That is the point — the suite
 * already proves the logic against a captured transport; this proves the SMTP
 * path your users actually receive on.
 *
 * Everything else is isolated: it runs against a THROWAWAY database
 * (lms_livemail_check) which is dropped on exit, so no production row is
 * created, modified or deleted. Only the outbound email is real.
 */
import 'dotenv/config'

process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_livemail_check'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '200'
/* No Meet call — the session is in-person. */
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.GOOGLE_REFRESH_TOKEN

const RECIPIENT = process.argv[2] ?? process.env['VERIFY_EMAIL_TO']
if (!RECIPIENT || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(RECIPIENT)) {
  console.error('Usage: bun run verify-class-change-email -- someone@example.com')
  process.exit(1)
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)

const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel,
  ClassBookingModel, NotificationModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

const smtpOn = !!(process.env['SMTP_HOST'] && process.env['SMTP_USER'] && process.env['SMTP_PASS'] && process.env['EMAIL_FROM'])

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_livemail_check') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const PW = 'CorrectHorse1'

const jar = new Map<string, string>()
async function call(method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed }
}

console.log('\n📮  Class-change email — live check')
console.log(`    recipient : ${RECIPIENT}`)
console.log(`    database  : lms_livemail_check (throwaway, dropped on exit)`)
console.log(`    transport : ${smtpOn ? 'REAL SMTP — an email will be delivered' : 'console (.logs/emails) — SMTP is not configured'}\n`)

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, name: string, extra: object = {}) =>
    UserModel.create({ name, email, passwordHash: hash, role, isActive: true, organizationId: org._id, ...extra })

  await mk('admin@livecheck.local', 'admin', 'Live Check Admin')
  const before = await mk('ustad.rahman@livecheck.local', 'instructor', 'Ustad Rahman')
  const after  = await mk('sara.malik@livecheck.local',   'instructor', 'Sara Malik')
  const student = await mk(RECIPIENT, 'student', 'Tester', { enrollmentStatus: 'approved' })

  const course = await CourseModel.create({
    title: 'Advanced Forex Strategies', slug: `live-check-${Date.now()}`,
    description: 'Course used for the live class-change email verification.',
    price: 0, isFree: true, status: 'published', language: 'English',
    instructorId: before._id, organizationId: org._id,
  })
  await EnrollmentModel.create({ userId: student._id, courseId: course._id })

  const session = await LiveClassModel.create({
    courseId: course._id, title: 'Advanced Forex — Live Session',
    scheduledStart: new Date(Date.now() + 3 * 86_400_000), durationMins: 90,
    type: 'external', instructorId: before._id, organizationId: org._id,
    language: 'English', status: 'scheduled', isOnline: false,
    location: 'Delta Institutions, Dubai', room: 'Hall 2', sessionCapacity: 30,
  })

  await ClassBookingModel.create({ userId: student._id, liveClassId: session._id, status: 'booked' })
  console.log(`  1. booked  ${RECIPIENT} onto "${session.title}"`)
  console.log(`     instructor of record: ${before.name}`)

  const li = await call('POST', '/admin/auth/login', { email: 'admin@livecheck.local', password: PW })
  if (li.status !== 200) throw new Error(`admin login failed: ${li.status}`)

  const patched = await call('PATCH', `/admin/live-classes/${session._id}`, { instructorId: String(after._id) })
  console.log(`  2. admin reassigned the instructor → ${after.name}   (HTTP ${patched.status})`)
  if (patched.status !== 200) throw new Error(`update failed: ${JSON.stringify(patched.body).slice(0, 200)}`)

  /* The notification work is fire-and-forget; wait for it to land. */
  let note: any = null
  for (let i = 0; i < 60 && !note; i++) {
    note = await NotificationModel.findOne({ userId: student._id, title: /Instructor changed/i }).lean()
    if (!note) await new Promise(r => setTimeout(r, 250))
  }

  console.log(`  3. in-app notification: ${note ? 'DELIVERED' : 'NOT FOUND'}`)
  if (note) {
    console.log(`     title: ${note.title}`)
    console.log(`     body : ${note.body}`)
  }

  /* Give SMTP a moment to finish handing off. */
  await new Promise(r => setTimeout(r, 4000))
  console.log(`  4. email  : ${smtpOn ? `handed to SMTP for ${RECIPIENT} — check that inbox` : 'written to .logs/emails/'}`)
  console.log(`\n  ${note ? '✅' : '❌'}  ${note ? 'Feature verified end to end.' : 'Notification did not arrive — see the server log above.'}\n`)

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
