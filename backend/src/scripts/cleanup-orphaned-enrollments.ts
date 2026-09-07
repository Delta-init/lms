/* ─────────────────────────────────────────────────────
   Remove enrolments whose student account no longer exists.

   They were produced by the admin delete path, which removed the user row and
   left everything attached to it behind (fixed in services/userCascade.ts —
   both delete paths now cascade). The rows that already exist are still there,
   and the admin course table counts enrolments, so each one inflates a course's
   student count by one with nobody to show for it.

   Two things happen here, in order:

     1. the orphaned enrolment rows are deleted;
     2. every affected course has its `enrolledCount` recomputed from what
        actually remains — not decremented, recomputed, so a counter that was
        already wrong for some other reason comes out right rather than
        merely less wrong.

     bun run src/scripts/cleanup-orphaned-enrollments.ts          # report only
     bun run src/scripts/cleanup-orphaned-enrollments.ts --apply  # delete

   Report mode is the default because this DELETES rows. Read the report, and
   note that an orphan is not recoverable information: the account it pointed
   at is already gone, so the row records that somebody unnamed was once
   enrolled. If that history matters to you, export the report before applying.
───────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import { CourseModel, EnrollmentModel, UserModel } from '@/models/schema.ts'

const APPLY = process.argv.includes('--apply')

interface OrphanGroup {
  _id: mongoose.Types.ObjectId | null
  n: number
  ids: mongoose.Types.ObjectId[]
  sources: (string | null)[]
}

async function main(): Promise<void> {
  await mongoose.connect(env.DATABASE_URL)
  console.log(`\n  database: ${mongoose.connection.db?.databaseName}`)
  console.log(`  mode:     ${APPLY ? 'APPLY (will delete)' : 'report only — pass --apply to delete'}\n`)

  const groups = await EnrollmentModel.aggregate<OrphanGroup>([
    { $lookup: { from: UserModel.collection.name, localField: 'userId', foreignField: '_id', as: 'u' } },
    { $match: { u: { $size: 0 } } },
    { $group: { _id: '$courseId', n: { $sum: 1 }, ids: { $push: '$_id' }, sources: { $push: '$source' } } },
    { $sort: { n: -1 } },
  ])

  if (!groups.length) {
    console.log('  no orphaned enrolments. Nothing to do.\n')
    await mongoose.disconnect()
    return
  }

  const courses = await CourseModel.find(
    { _id: { $in: groups.map(g => g._id).filter(Boolean) } },
    { title: 1, enrolledCount: 1 },
  ).lean()
  const titleOf = new Map(courses.map(c => [String(c._id), String(c.title ?? '(untitled)')]))

  console.log(`  ${'course'.padEnd(38)}${'orphans'.padEnd(10)}sources`)
  console.log(`  ${''.padEnd(74, '-')}`)
  let total = 0
  for (const g of groups) {
    total += g.n
    const tally = g.sources.reduce<Record<string, number>>((acc, s) => {
      const k = s ?? 'unknown'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    const label = g._id ? (titleOf.get(String(g._id)) ?? '(course deleted)') : '(no course)'
    console.log(
      `  ${label.slice(0, 36).padEnd(38)}${String(g.n).padEnd(10)}` +
      Object.entries(tally).map(([k, v]) => `${k}:${v}`).join(' '),
    )
  }
  console.log(`  ${''.padEnd(74, '-')}`)
  console.log(`  ${total} orphaned enrolment(s) across ${groups.length} course(s).`)

  if (!APPLY) {
    console.log('\n  re-run with --apply to delete them.\n')
    await mongoose.disconnect()
    return
  }

  const ids = groups.flatMap(g => g.ids)
  const del = await EnrollmentModel.deleteMany({ _id: { $in: ids } })
  console.log(`\n  deleted ${del.deletedCount} enrolment row(s).`)

  /* Recompute rather than decrement — see the header. */
  const affected = groups.map(g => g._id).filter(Boolean) as mongoose.Types.ObjectId[]
  const remaining = await EnrollmentModel.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
    { $match: { courseId: { $in: affected } } },
    { $group: { _id: '$courseId', n: { $sum: 1 } } },
  ])
  const nowByCourse = new Map(remaining.map(r => [String(r._id), r.n]))

  const res = await CourseModel.bulkWrite(
    affected.map(id => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { enrolledCount: nowByCourse.get(String(id)) ?? 0 } },
      },
    })),
    { ordered: false },
  )
  console.log(`  recomputed enrolledCount on ${res.modifiedCount} course(s).\n`)

  await mongoose.disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
