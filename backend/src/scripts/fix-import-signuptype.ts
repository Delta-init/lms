/* ─────────────────────────────────────────────────────────────
   Move bulk-imported students out of the Express Members tab and into
   the normal students / enrollment-requests table.

   Why this exists: the first production import stamped signupType 'express'
   on every imported student. `listEnrollmentRequests` (admin.controller.ts)
   filters `signupType: { $ne: 'express' }`, so those accounts — already
   approved, already carrying the Bulk Import badge — were routed to the
   separate Express Members section instead of the students table.

   This flips ONLY accounts approved by the bulk importer
   (approvedByEmail 'bulk-import@system') from 'express' to 'full'.
   Nothing else is touched: approval status, category, org, badge and
   profile data all stay exactly as they are, and genuine express signups
   from real students are left alone.

   Usage (from backend/):
     bun src/scripts/fix-import-signuptype.ts            # report only
     bun src/scripts/fix-import-signuptype.ts --apply    # make the change
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const BADGE_EMAIL = 'bulk-import@system'
const APPLY = process.argv.includes('--apply')

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db    = mongoose.connection.db!
const users = db.collection('users')

const report = async (label: string) => {
  const [imported, asExpress, asFull, approved] = await Promise.all([
    users.countDocuments({ approvedByEmail: BADGE_EMAIL }),
    users.countDocuments({ approvedByEmail: BADGE_EMAIL, signupType: 'express' }),
    users.countDocuments({ approvedByEmail: BADGE_EMAIL, signupType: 'full' }),
    users.countDocuments({ approvedByEmail: BADGE_EMAIL, enrollmentStatus: 'approved' }),
  ])
  const otherExpress = await users.countDocuments({
    signupType: 'express', approvedByEmail: { $ne: BADGE_EMAIL },
  })
  console.log(`  ${label}`)
  console.log(`    imported students (badge ${BADGE_EMAIL}) : ${imported}`)
  console.log(`      · approved                             : ${approved}`)
  console.log(`      · signupType 'express' (Express tab)   : ${asExpress}`)
  console.log(`      · signupType 'full'    (Students tab)  : ${asFull}`)
  console.log(`    other express members (NOT touched)      : ${otherExpress}`)
}

console.log('═'.repeat(60))
console.log(`  Database: ${db.databaseName}   Mode: ${APPLY ? 'APPLY' : 'REPORT ONLY'}`)
console.log('═'.repeat(60))
await report('Before:')

if (APPLY) {
  const res = await users.updateMany(
    { approvedByEmail: BADGE_EMAIL, signupType: 'express' },
    { $set: { signupType: 'full' } },
  )
  console.log(`\n  → moved ${res.modifiedCount} student(s) to the students table\n`)
  await report('After:')
} else {
  console.log('\n  Nothing changed. Re-run with --apply to move them.\n')
}

await mongoose.disconnect()
process.exit(0)
