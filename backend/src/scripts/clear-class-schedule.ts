/* ─────────────────────────────────────────────────────────────
   Delete every row from ONE scheduling collection.

   This is the most destructive script in the repo, so it is built to be hard
   to fire by accident and easy to undo:

     · --target picks exactly one collection from a fixed allow-list. There is
       no "all", and no free-text collection name — a typo cannot reach the
       users or courses collection.
     · Report-only unless --apply is given.
     · --apply additionally requires --confirm=<N> where N is the exact number
       of documents currently in that collection. A stale count (someone added
       a class while you were reading) aborts rather than deletes.
     · Every row is written to .logs/deleted/ as gzipped Extended JSON BEFORE
       anything is removed, so a mistake is restorable. --no-backup skips it,
       and you should not use --no-backup.

   Dependants are reported, never silently removed. Deleting live classes
   leaves bookings, feedback, homework, per-student assignments and handoffs
   pointing at ids that no longer exist; --cascade clears those too (each one
   backed up the same way).

   Usage (from backend/):
     bun src/scripts/clear-class-schedule.ts --target=live-classes
     bun src/scripts/clear-class-schedule.ts --target=live-classes --apply --confirm=214
     bun src/scripts/clear-class-schedule.ts --target=live-classes --apply --confirm=214 --cascade
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}

/** The only collections this script may ever touch. */
const TARGETS = {
  'live-classes': { model: 'LiveClass',          label: 'Live classes (the class schedule / timetable)' },
  'availability': { model: 'MentorAvailability', label: 'Mentor availability slots' },
  'bookings':     { model: 'ClassBooking',       label: 'Student class bookings' },
} as const
type TargetKey = keyof typeof TARGETS

/** Collections whose rows point at a live class. Reported, cleared only with --cascade. */
const LIVECLASS_DEPENDANTS = [
  { model: 'ClassBooking',    field: 'liveClassId', label: 'student bookings' },
  { model: 'ClassFeedback',   field: 'liveClassId', label: 'class feedback' },
  { model: 'SessionHomework', field: 'liveClassId', label: 'session homework' },
  { model: 'ClassAssignment', field: 'liveClassId', label: 'per-student class assignments' },
  { model: 'ClassHandoff',    field: 'liveClassId', label: 'class handoffs' },
] as const

const TARGET   = args.get('target') as TargetKey | undefined
const APPLY    = args.has('apply')
const CASCADE  = args.has('cascade')
const BACKUP   = !args.has('no-backup')
const CONFIRM  = args.has('confirm') ? Number(args.get('confirm')) : undefined

if (!TARGET || !(TARGET in TARGETS)) {
  console.error(`❌ --target is required and must be one of: ${Object.keys(TARGETS).join(' | ')}`)
  console.error('   Example: --target=live-classes')
  process.exit(1)
}

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db     = mongoose.connection.db!
const dbName = db.databaseName
await import('@/models/schema.ts')            // registers every model

const model = mongoose.model(TARGETS[TARGET].model)
const total = await model.countDocuments({})

console.log('═'.repeat(64))
console.log(`  Mode:       ${APPLY ? 'APPLY — ROWS WILL BE DELETED' : 'REPORT ONLY'}`)
console.log(`  Database:   ${dbName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Target:     ${TARGETS[TARGET].label}`)
console.log(`  Collection: ${model.collection.collectionName}`)
console.log('═'.repeat(64))
console.log(`\n  Documents in this collection: ${total}`)

if (total === 0) {
  console.log('\n  Already empty — nothing to do.\n')
  await mongoose.disconnect(); process.exit(0)
}

/* ── what else points at these rows ── */
const deps: { model: string; label: string; count: number }[] = []
if (TARGET === 'live-classes') {
  for (const d of LIVECLASS_DEPENDANTS) {
    const c = await mongoose.model(d.model).countDocuments({})
    if (c > 0) deps.push({ model: d.model, label: d.label, count: c })
  }
  if (deps.length) {
    console.log('\n  These rows reference a live class and would be ORPHANED:')
    for (const d of deps) console.log(`    ${String(d.count).padStart(7)}  ${d.label}  (${d.model})`)
    console.log(CASCADE
      ? '\n  --cascade is set: they will be deleted too (each backed up first).'
      : '\n  They will be LEFT IN PLACE. Add --cascade to remove them as well.')
  }
}

/* ── the interlock ── */
if (!APPLY) {
  console.log(`\n  Nothing was deleted.`)
  console.log(`  To delete, re-run with:  --apply --confirm=${total}${CASCADE ? ' --cascade' : ''}\n`)
  await mongoose.disconnect(); process.exit(0)
}
if (CONFIRM !== total) {
  console.error(`\n❌ --confirm=${CONFIRM ?? '(missing)'} does not match the ${total} documents currently present.`)
  console.error(`   This guard exists so a stale command cannot delete rows you have not seen.`)
  console.error(`   Re-run with --confirm=${total} if ${total} is really what you mean to delete.\n`)
  await mongoose.disconnect(); process.exit(1)
}

/* ── backup, then delete ── */
const dir = join(process.cwd(), '.logs', 'deleted')
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const { EJSON } = mongoose.mongo.BSON

async function wipe(modelName: string, label: string) {
  const m    = mongoose.model(modelName)
  const name = m.collection.collectionName
  const n    = await m.countDocuments({})
  if (n === 0) { console.log(`    ${label}: already empty`); return }

  if (BACKUP) {
    const docs = await m.collection.find({}).toArray()
    const file = join(dir, `${name}_${stamp}.ejson.gz`)
    writeFileSync(file, gzipSync(Buffer.from(
      EJSON.stringify({ collection: name, takenAt: new Date().toISOString(), documents: docs }, { relaxed: false }),
      'utf8',
    )))
    console.log(`    ${label}: ${n} rows backed up -> ${file}`)
  }
  const res = await m.deleteMany({})
  console.log(`    ${label}: ${res.deletedCount} deleted`)
}

console.log('\n  Working…')
if (CASCADE && TARGET === 'live-classes') {
  for (const d of deps) await wipe(d.model, d.label)
}
await wipe(TARGETS[TARGET].model, TARGETS[TARGET].label)

const left = await model.countDocuments({})
console.log(`\n  ${model.collection.collectionName} now holds ${left} documents.`)
if (BACKUP) {
  console.log(`  Backups are in ${dir} — restore with db-snapshot.ts or mongorestore if needed.`)
}
if (!CASCADE && deps.length) {
  console.log(`\n  ⚠️  ${deps.reduce((a, d) => a + d.count, 0)} row(s) in ${deps.length} collection(s) now reference`)
  console.log('     live classes that no longer exist. Re-run with --cascade to clear them.')
}
console.log()

await mongoose.disconnect()
process.exit(0)
