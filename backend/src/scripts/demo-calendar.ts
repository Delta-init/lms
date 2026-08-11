/* Fixtures for the month-calendar overflow: eight live classes on a single
   day, so the "+N more" path and the day panel have something to show.

   Every row is titled with `demo-cal`, and --clean removes exactly those.
   Reuses the instructor/course created by demo-assignments.ts when present.

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
      console.error('Need at least one instructor and one course — run demo-assignments.ts first.')
      process.exit(1)
    }

    /* All eight on the SAME day, spread across the working day so the sort
       is visible: the cell should show the three earliest. */
    const day = new Date()
    day.setDate(day.getDate() + 2)
    const hours = [9, 10, 11, 13, 14, 15, 17, 19]

    for (const [i, h] of hours.entries()) {
      const start = new Date(day)
      start.setHours(h, 0, 0, 0)
      await LiveClassModel.create({
        courseId:       course._id,
        sectionId:      section?._id,
        title:          `Session ${i + 1} — ${h}:00 (${TAG})`,
        scheduledStart: start,
        durationMins:   60,
        type:           'external',
        instructorId:   instructor._id,
        organizationId: (course as any).organizationId ?? org?._id,
        language:       'English',
        status:         'scheduled',
        isOnline:       false,
        location:       'Dubai Campus',
        room:           `R${i + 1}`,
        sessionCapacity: 30,
      })
    }
    console.log(`\ncreated ${hours.length} classes on ${day.toDateString()}`)
    console.log(`instructor: ${(instructor as { name?: string }).name}`)
  }
} finally {
  await mongoose.disconnect()
}
