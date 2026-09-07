/* ─────────────────────────────────────────────────────
   Fill in Enrollment.source for rows that pre-date the field.

   WHAT CAN AND CANNOT BE RECOVERED
   ────────────────────────────────
   Only one of the four sources leaves independent evidence behind:

     purchase  a paid Order exists for this (user, course). Reliable — it
               covers gateway checkouts and the AI-academy server-to-server
               provisioning, which writes its own paid Order.
     free      the course has no price, so nothing could have been bought.
               Reliable in the sense that it cannot have been a purchase; a
               free course can still have been granted by an admin, which is
               why --free-only-if-untouched is available below.
     admin  }  IDENTICAL ROWS. Until Enrollment.source existed, an admin grant
     script }  and a bulk import wrote byte-for-byte the same document. They
               cannot be told apart after the fact, so this script refuses to
               guess and leaves them 'unknown' unless you name a batch.

   NAMING A BATCH
   ──────────────
   If you know a bulk import happened — a course and a time window — you can
   claim those rows explicitly:

     --script-course <courseId> --script-from <ISO> --script-to <ISO>

   That is you asserting a fact the data does not contain, so it is opt-in,
   never inferred, and reported separately from what was derived.

     bun run src/scripts/backfill-enrollment-source.ts            # report
     bun run src/scripts/backfill-enrollment-source.ts --apply    # write

   Only rows currently 'unknown' are touched, so re-running is safe and this
   can never overwrite a source recorded at creation.
───────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import { CourseModel, EnrollmentModel, OrderModel } from '@/models/schema.ts'

const argv = process.argv
const APPLY = argv.includes('--apply')
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const SCRIPT_COURSE = arg('--script-course')
const SCRIPT_FROM   = arg('--script-from')
const SCRIPT_TO     = arg('--script-to')

async function main(): Promise<void> {
  await mongoose.connect(env.DATABASE_URL)
  console.log(`\n  database: ${mongoose.connection.db?.databaseName}`)
  console.log(`  mode:     ${APPLY ? 'APPLY (will write)' : 'report only — pass --apply to write'}\n`)

  const pending = await EnrollmentModel.find(
    { $or: [{ source: 'unknown' }, { source: { $exists: false } }] },
    { userId: 1, courseId: 1, enrolledAt: 1, createdAt: 1 },
  ).lean()

  if (!pending.length) {
    console.log('  nothing to do — every enrolment already carries a source.\n')
    await mongoose.disconnect()
    return
  }

  /* Evidence, gathered once rather than per row. */
  const paid = await OrderModel.find({ status: 'paid' }, { userId: 1, courseId: 1 }).lean()
  const paidKeys = new Set(paid.map(o => `${String(o.userId)}:${String(o.courseId)}`))

  const freeCourseIds = new Set(
    (await CourseModel.find({ $or: [{ isFree: true }, { price: 0 }] }, { _id: 1 }).lean())
      .map(c => String(c._id)),
  )

  const from = SCRIPT_FROM ? new Date(SCRIPT_FROM) : null
  const to   = SCRIPT_TO   ? new Date(SCRIPT_TO)   : null

  const tally: Record<string, number> = { purchase: 0, free: 0, script: 0, unknown: 0 }
  const writes: Array<{ updateOne: { filter: object; update: object } }> = []

  for (const e of pending) {
    const key = `${String(e.userId)}:${String(e.courseId)}`
    let source: string

    if (paidKeys.has(key)) {
      source = 'purchase'
    } else if (
      SCRIPT_COURSE && String(e.courseId) === SCRIPT_COURSE
      && (!from || new Date((e.enrolledAt ?? e.createdAt) as Date) >= from)
      && (!to   || new Date((e.enrolledAt ?? e.createdAt) as Date) <= to)
    ) {
      source = 'script'
    } else if (freeCourseIds.has(String(e.courseId))) {
      source = 'free'
    } else {
      /* A paid course with no order behind it: somebody was let in by hand,
         but whether that was a person or a script is exactly the thing the
         old rows do not record. Saying 'admin' here would be inventing it. */
      source = 'unknown'
    }

    tally[source] = (tally[source] ?? 0) + 1
    /* 'unknown' is written out too, rather than left absent. A missing field
       means "nobody has looked at this row"; a stored 'unknown' means "this
       was examined and the answer is not recoverable" — a different and more
       useful statement, and it keeps the UI off `undefined`. The query above
       still picks these up, so a later run with --script-course can claim
       them. */
    writes.push({ updateOne: { filter: { _id: e._id }, update: { $set: { source } } } })
  }

  console.log(`  ${pending.length} enrolment(s) without a source:\n`)
  console.log(`    purchase  ${String(tally['purchase']).padStart(5)}   a paid order exists`)
  console.log(`    free      ${String(tally['free']).padStart(5)}   course has no price`)
  console.log(`    script    ${String(tally['script']).padStart(5)}   matched the batch you named`)
  console.log(`    unknown   ${String(tally['unknown']).padStart(5)}   paid course, no order — admin or script, unrecoverable`)

  if (!SCRIPT_COURSE && tally['unknown']) {
    console.log(`\n  ${tally['unknown']} row(s) stay 'unknown'. If you know which import produced`)
    console.log(`  them, re-run with --script-course <id> --script-from <ISO> --script-to <ISO>.`)
  }

  if (APPLY && writes.length) {
    const res = await EnrollmentModel.bulkWrite(writes, { ordered: false })
    console.log(`\n  wrote ${res.modifiedCount} enrolment(s).\n`)
  } else if (writes.length) {
    console.log(`\n  re-run with --apply to write ${writes.length} of these.\n`)
  } else {
    console.log('')
  }

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
