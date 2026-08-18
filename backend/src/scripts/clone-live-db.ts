/* ─────────────────────────────────────────────────────
   Copy the live database into a local one.

   READ-ONLY on the source. Nothing is written, updated or dropped on the
   remote server at any point — the only writes go to the local target.

   The target is a SEPARATE database by default (lms_live_copy), not `lms`,
   so an existing local dev database is never silently replaced. Point the app
   at the copy, or re-run with --target=lms once you have decided you want it.

   Usage:
     bun src/scripts/clone-live-db.ts                      # -> lms_live_copy
     bun src/scripts/clone-live-db.ts --target=lms_staging  # -> another name
     bun src/scripts/clone-live-db.ts --drop                # empty target first
     bun src/scripts/clone-live-db.ts --skip=refreshtokens,authtokens
───────────────────────────────────────────────────── */
/* mongodb and bson are NOT direct dependencies — they arrive under mongoose.
   Importing them by name works locally only because the package manager
   hoisted them; on a server with a different layout the script dies with
   "Cannot find package 'mongodb'". Mongoose re-exports the exact driver it
   uses, so this resolves anywhere mongoose does and can never drift from the
   driver version the app itself runs. */
import mongoose from 'mongoose'
const { MongoClient } = mongoose.mongo

const SOURCE_URI = process.env['CLONE_SOURCE_URI'] ?? ''
const LOCAL_URI  = process.env['CLONE_TARGET_URI'] ?? 'mongodb://localhost:27017'

const arg = (name: string, fallback = '') =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback

const TARGET_DB = arg('target', 'lms_live_copy')
const DROP      = process.argv.includes('--drop')
const SKIP      = new Set(arg('skip').split(',').map(s => s.trim()).filter(Boolean))
const BATCH     = 500

if (!SOURCE_URI) {
  console.error('Set CLONE_SOURCE_URI to the live connection string.')
  process.exit(1)
}
/* A typo here would point the copy at the live server. Refuse anything that
   is not clearly a local target. */
if (!/(localhost|127\.0\.0\.1)/.test(LOCAL_URI)) {
  console.error(`Target must be local. Got: ${LOCAL_URI}`)
  process.exit(1)
}

const src = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 20_000 })
const dst = new MongoClient(LOCAL_URI,  { serverSelectionTimeoutMS: 10_000 })

try {
  await src.connect()
  await dst.connect()

  const sdb = src.db()
  const tdb = dst.db(TARGET_DB)
  console.log(`source : ${sdb.databaseName} @ live  (read-only)`)
  console.log(`target : ${TARGET_DB} @ local`)
  if (DROP) console.log('mode   : --drop (target collections emptied first)')
  console.log('')

  const names = (await sdb.listCollections().toArray())
    .map(c => c.name)
    .filter(n => !n.startsWith('system.'))
    .sort()

  let copied = 0, skipped = 0
  const report: Array<{ name: string; from: number; to: number; ok: boolean }> = []

  for (const name of names) {
    const from = await sdb.collection(name).countDocuments()
    if (SKIP.has(name)) {
      console.log(`  skip  ${name}`)
      skipped++
      continue
    }
    if (DROP) await tdb.collection(name).deleteMany({})

    if (from > 0) {
      const cursor = sdb.collection(name).find({})
      let buf: any[] = []
      for await (const doc of cursor) {
        buf.push(doc)
        if (buf.length >= BATCH) {
          /* Upsert by _id rather than insert, so a re-run is idempotent and a
             half-finished copy can simply be run again. */
          await tdb.collection(name).bulkWrite(
            buf.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
            { ordered: false },
          )
          buf = []
        }
      }
      if (buf.length) {
        await tdb.collection(name).bulkWrite(
          buf.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
          { ordered: false },
        )
      }
    }

    const to = await tdb.collection(name).countDocuments()
    const ok = to >= from
    report.push({ name, from, to, ok })
    copied++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${String(from).padStart(6)} -> ${String(to).padStart(6)}  ${name}`)
  }

  const bad = report.filter(r => !r.ok)
  console.log(`\n${copied} collections copied, ${skipped} skipped`)
  console.log(`source total: ${report.reduce((a, r) => a + r.from, 0)}   target total: ${report.reduce((a, r) => a + r.to, 0)}`)
  if (bad.length) {
    console.log(`\nMISMATCHED: ${bad.map(b => `${b.name} (${b.from}->${b.to})`).join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('every collection matched or exceeded the source count')
  }
} finally {
  await src.close().catch(() => {})
  await dst.close().catch(() => {})
}
