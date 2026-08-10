/* ─────────────────────────────────────────────────────
   Fixtures for walking the assignments feature through a real browser.

   Creates one instructor, one student, one past live class and a booking
   linking them, so the student's "which class is this for?" dropdown has
   something in it and the instructor's queue has an owner.

   Every row it writes carries `demo-asg` in the email or title, and
   `--clean` removes exactly those and nothing else. It never touches a row
   it did not create, and it refuses to run against a database whose name
   looks like production.

   Run:  bun src/scripts/demo-assignments.ts
   Undo: bun src/scripts/demo-assignments.ts --clean
───────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import {
  UserModel, CourseModel, SectionModel, LiveClassModel,
  ClassBookingModel, EnrollmentModel, ClassAssignmentModel, OrganizationModel,
} from '@/models/schema.ts'
import { hashPassword } from '@/utils/hash.ts'

const TAG      = 'demo-asg'
const STUDENT  = `${TAG}-student@delta.local`
const TEACHER  = `${TAG}-instructor@delta.local`
const PASSWORD = 'DemoAssign1'

const clean = process.argv.includes('--clean')

await mongoose.connect(env.DATABASE_URL)
console.log(`connected to ${mongoose.connection.db!.databaseName}`)

async function removeFixtures() {
  const users   = await UserModel.find({ email: { $in: [STUDENT, TEACHER] } }).select('_id').lean()
  const userIds = users.map(u => u._id)
  const classes = await LiveClassModel.find({ title: new RegExp(TAG) }).select('_id').lean()
  const classIds = classes.map(c => c._id)
  const courses  = await CourseModel.find({ slug: new RegExp(`^${TAG}`) }).select('_id').lean()

  const r = {
    assignments: (await ClassAssignmentModel.deleteMany({ $or: [{ studentId: { $in: userIds } }, { liveClassId: { $in: classIds } }] })).deletedCount,
    bookings:    (await ClassBookingModel.deleteMany({ $or: [{ userId: { $in: userIds } }, { liveClassId: { $in: classIds } }] })).deletedCount,
    classes:     (await LiveClassModel.deleteMany({ _id: { $in: classIds } })).deletedCount,
    sections:    (await SectionModel.deleteMany({ courseId: { $in: courses.map(c => c._id) } })).deletedCount,
    enrollments: (await EnrollmentModel.deleteMany({ userId: { $in: userIds } })).deletedCount,
    courses:     (await CourseModel.deleteMany({ _id: { $in: courses.map(c => c._id) } })).deletedCount,
    users:       (await UserModel.deleteMany({ _id: { $in: userIds } })).deletedCount,
  }
  console.log('removed:', r)
}

try {
  if (clean) {
    await removeFixtures()
  } else {
    /* Idempotent: a re-run starts from a clean slate rather than stacking. */
    await removeFixtures()

    const org  = await OrganizationModel.findOne().lean()
    const hash = await hashPassword(PASSWORD)

    const teacher = await UserModel.create({
      name: 'Demo Instructor', email: TEACHER, passwordHash: hash,
      role: 'instructor', isActive: true, isEmailVerified: true, organizationId: org?._id,
    })
    const student = await UserModel.create({
      name: 'Demo Student', email: STUDENT, passwordHash: hash,
      role: 'student', isActive: true, isEmailVerified: true,
      enrollmentStatus: 'approved', organizationId: org?._id,
    })

    const course = await CourseModel.create({
      title: 'Demo Trading Course', slug: `${TAG}-course-${Date.now()}`,
      description: 'Fixture course for the assignments walkthrough.',
      price: 0, isFree: true, status: 'published', language: 'English',
      instructorId: teacher._id, organizationId: org?._id,
    })
    const module1 = await SectionModel.create({ courseId: course._id, title: 'Module 1 — Risk Management', order: 1 })
    const module2 = await SectionModel.create({ courseId: course._id, title: 'Module 2 — Charting',        order: 2 })
    await EnrollmentModel.create({ userId: student._id, courseId: course._id })

    const mkClass = (title: string, section: typeof module1, daysAgo: number) => LiveClassModel.create({
      courseId: course._id, sectionId: section._id, title: `${title} (${TAG})`,
      scheduledStart: new Date(Date.now() - daysAgo * 86_400_000),
      durationMins: 60, type: 'external', instructorId: teacher._id,
      organizationId: org?._id, language: 'English', status: 'ended',
      isOnline: false, location: 'Dubai Campus', room: 'A1', sessionCapacity: 30,
    })
    const c1 = await mkClass('Risk Management Live', module1, 3)
    const c2 = await mkClass('Charting Fundamentals', module2, 1)

    await ClassBookingModel.create({ userId: student._id, liveClassId: c1._id, status: 'attended' })
    await ClassBookingModel.create({ userId: student._id, liveClassId: c2._id, status: 'attended' })

    console.log(`\nstudent    ${STUDENT}  /  ${PASSWORD}`)
    console.log(`instructor ${TEACHER}  /  ${PASSWORD}`)
    console.log(`classes    ${c1.title} · ${c2.title}`)
  }
} finally {
  await mongoose.disconnect()
}
