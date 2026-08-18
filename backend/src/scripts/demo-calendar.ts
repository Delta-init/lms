/* Fixtures for eyeballing the class-schedule date labels.

   Creates a handful of live classes spread across today, tomorrow, later this
   week and a future month, so every branch of the day label is visible at
   once: Today / Tomorrow / "Sun 17 Aug" / "Wed 23 Sep" / a next-year date
   that has to carry its year.

   Every row is titled with `demo-cal`; --clean removes exactly those and
   nothing else.

   Run:  bun src/scripts/demo-calendar.ts
   Undo: bun src/scripts/demo-calendar.ts --clean
*/
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import { UserModel, CourseModel, SectionModel, LiveClassModel, OrganizationModel } from '@/models/schema.ts'

const TAG   = 'demo-cal'
const clean = process.argv.includes('--clean')

await mongoose.connect(env.DATABASE_URL)
console.log(`connected to ${mongoose.connection.db!.databaseName}`)

try {
  const removed = await LiveClassModel.deleteMany({ title: new RegExp(TAG) })
  console.log(`removed ${removed.deletedCount} existing ${TAG} classes`)

  if (!clean) {
    const instructor = await UserModel.findOne({ role: 'instructor' }).select('_id name').lean()
    const course     = await CourseModel.findOne().select('_id title organizationId').lean()
    const section    = await SectionModel.findOne({ courseId: course?._id }).select('_id').lean()
    const org        = await OrganizationModel.findOne().select('_id').lean()
    if (!instructor || !course) {
      console.error('Need at least one instructor and one course.')
      process.exit(1)
    }

    /* [days from today, hour, label the UI should produce] */
    const plan: Array<[number, number, string]> = [
      [0,   9,  'Today'],
      [0,  14,  'Today (afternoon)'],
      [1,  10,  'Tomorrow'],
      [3,  11,  'later this week'],
      [40, 16,  'next month'],
      [150, 9,  'next year — must show the year'],
    ]

    for (const [offset, hour, why] of plan) {
      const start = new Date()
      start.setDate(start.getDate() + offset)
      start.setHours(hour, 0, 0, 0)
      await LiveClassModel.create({
        courseId:       course._id,
        sectionId:      section?._id,
        title:          `${why} (${TAG})`,
        scheduledStart: start,
        durationMins:   60,
        type:           'external',
        instructorId:   instructor._id,
        organizationId: (course as any).organizationId ?? org?._id,
        language:       'English',
        status:         'scheduled',
        isOnline:       true,
        sessionCapacity: 30,
      })
      console.log(`  ${start.toDateString()} ${String(hour).padStart(2, '0')}:00  — ${why}`)
    }
    console.log(`\ncreated ${plan.length} classes`)
  }
} finally {
  await mongoose.disconnect()
}
