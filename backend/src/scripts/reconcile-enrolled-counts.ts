/* ─────────────────────────────────────────────────────
   Recompute Course.enrolledCount from the enrolments that actually exist.

   `enrolledCount` is a denormalised counter. It is incremented on exactly two
   of the paths that create an enrolment — self-enrol (enrollment.service) and
   purchase (order.service) — and on none of the paths that remove one. Admin
   enrolments and the bulk-import scripts also write straight to the
   collection. The number therefore drifts upward and never recovers, and any
   course created by scripts/seed.ts starts life holding
   `Math.random() * 3000`.

   This walks every course, counts its enrolments, and writes the truth back.
   Safe to re-run: it is idempotent, and it only writes where the two disagree.

     bun run src/scripts/reconcile-enrolled-counts.ts          # report only
     bun run src/scripts/reconcile-enrolled-counts.ts --apply  # write

   Report mode is the default on purpose — this touches every course document,
   so the first run should show you what it intends to do.
───────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import { CourseModel, EnrollmentModel } from '@/models/schema.ts'

const APPLY = process.argv.includes('--apply')

async function main(): Promise<void> {
  await mongoose.connect(env.DATABASE_URL)
  const dbName = mongoose.connection.db?.databaseName
  console.log(`\n  database: ${dbName}`)
  console.log(`  mode:     ${APPLY ? 'APPLY (will write)' : 'report only — pass --apply to write'}\n`)

  /* One grouped pass over enrolments rather than a query per course: the
     collection is large and the course list is not. */
  const grouped = await EnrollmentModel.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
    { $group: { _id: '$courseId', n: { $sum: 1 } } },
  ])
  const actualByCourse = new Map(grouped.map(g => [String(g._id), g.n]))

  const courses = await CourseModel.find({}, { title: 1, enrolledCount: 1 }).lean()

  const drifted: Array<{ title: string; stored: number; actual: number }> = []
  for (const c of courses) {
    const stored = (c as { enrolledCount?: number }).enrolledCount ?? 0
    const actual = actualByCourse.get(String(c._id)) ?? 0
    if (stored !== actual) {
      drifted.push({ title: String(c.title ?? '(untitled)'), stored, actual })
    }
  }

  if (!drifted.length) {
    console.log(`  every one of ${courses.length} courses already matches. Nothing to do.\n`)
  } else {
    console.log(`  ${'course'.padEnd(44)}${'stored'.padEnd(9)}${'actual'.padEnd(9)}delta`)
    console.log(`  ${''.padEnd(70, '-')}`)
    for (const d of drifted.slice(0, 40)) {
      const delta = d.actual - d.stored
      console.log(
        `  ${d.title.slice(0, 42).padEnd(44)}${String(d.stored).padEnd(9)}${String(d.actual).padEnd(9)}${delta > 0 ? '+' : ''}${delta}`,
      )
    }
    if (drifted.length > 40) console.log(`  … and ${drifted.length - 40} more`)
    console.log(`\n  ${drifted.length} of ${courses.length} courses disagree with their enrolments.`)
  }

  if (APPLY && drifted.length) {
    const ops = courses.map(c => ({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { enrolledCount: actualByCourse.get(String(c._id)) ?? 0 } },
      },
    }))
    const res = await CourseModel.bulkWrite(ops, { ordered: false })
    console.log(`\n  wrote ${res.modifiedCount} course(s).\n`)
  } else if (drifted.length) {
    console.log(`\n  re-run with --apply to write these values.\n`)
  }

  await mongoose.disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
