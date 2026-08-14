/* ─────────────────────────────────────────────────────
   Snapshot / restore a local database as a single file.

   Why a file AND a database, rather than just keeping lms_live_copy around:
   the moment you run the app against a copy you start mutating it — a
   migration, a test checkout, a seed script. A database is not a backup of
   itself. The file is the thing you can always get back to; the database is
   disposable and rebuilt from the file whenever it drifts.

   Format is canonical Extended JSON, gzipped. NOT JSON.stringify: that turns
   ObjectId into a plain string and Date into an ISO string, so a restore
   would produce documents that no longer match any query keyed on _id and
   dates that sort as text. EJSON round-trips every BSON type exactly.

   Usage:
     bun src/scripts/db-snapshot.ts dump    --db=lms_live_copy
     bun src/scripts/db-snapshot.ts restore --db=lms_working --file=<path>
     bun src/scripts/db-snapshot.ts list

   Restore is additive by default (upsert on _id). Add --drop to make the
   target match the snapshot exactly.
───────────────────────────────────────────────────── */
import { MongoClient } from 'mongodb'
import { EJSON } from 'bson'
import { gzipSync, gunzipSync } from 'zlib'
import { mkdir, readdir, stat, writeFile, readFile } from 'fs/promises'
import { join } from 'path'

const LOCAL_URI = process.env['SNAPSHOT_URI'] ?? 'mongodb://localhost:27017'
/* Lives under .logs/, which is already gitignored — these files hold real
   user records and hashed session tokens and must never reach the repo. */
const DIR = join(process.cwd(), '.logs', 'db-snapshots')

const cmd = process.argv[2] ?? 'help'
const arg = (n: string, d = '') =>
  process.argv.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d
const DROP = process.argv.includes('--drop')

if (!/(localhost|127\.0\.0\.1)/.test(LOCAL_URI)) {
  console.error(`Refusing a non-local server: ${LOCAL_URI}`)
  process.exit(1)
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

async function dump(dbName: string) {
  const client = new MongoClient(LOCAL_URI)
  await client.connect()
  try {
    const db = client.db(dbName)
    const names = (await db.listCollections().toArray())
      .map(c => c.name).filter(n => !n.startsWith('system.')).sort()

    const payload: Record<string, unknown[]> = {}
    let total = 0
    for (const n of names) {
      const docs = await db.collection(n).find({}).toArray()
      payload[n] = docs
      total += docs.length
    }

    await mkdir(DIR, { recursive: true })
    const file = join(DIR, `${dbName}_${stamp()}.ejson.gz`)
    const body = EJSON.stringify({ db: dbName, takenAt: new Date().toISOString(), collections: payload },
                                 { relaxed: false })
    await writeFile(file, gzipSync(Buffer.from(body, 'utf8')))
    const size = (await stat(file)).size
    console.log(`snapshot written`)
    console.log(`  file        : ${file}`)
    console.log(`  collections : ${names.length}`)
    console.log(`  documents   : ${total}`)
    console.log(`  size        : ${(size / 1024).toFixed(0)} KB gzipped`)
  } finally { await client.close() }
}

async function restore(dbName: string, file: string) {
  const raw  = gunzipSync(await readFile(file)).toString('utf8')
  const snap = EJSON.parse(raw, { relaxed: false }) as {
    db: string; takenAt: string; collections: Record<string, any[]>
  }
  const client = new MongoClient(LOCAL_URI)
  await client.connect()
  try {
    const db = client.db(dbName)
    console.log(`restoring ${file}`)
    console.log(`  taken from ${snap.db} at ${snap.takenAt}`)
    console.log(`  into       ${dbName}${DROP ? '  (--drop: emptied first)' : ''}\n`)

    let total = 0, mismatched: string[] = []
    for (const [name, docs] of Object.entries(snap.collections)) {
      if (DROP) await db.collection(name).deleteMany({})
      if (docs.length) {
        await db.collection(name).bulkWrite(
          docs.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
          { ordered: false },
        )
      }
      const got = await db.collection(name).countDocuments()
      if (got < docs.length) mismatched.push(`${name} (${docs.length}->${got})`)
      total += docs.length
      if (docs.length) console.log(`  ${String(docs.length).padStart(6)}  ${name}`)
    }
    console.log(`\n${total} documents restored into ${dbName}`)
    if (mismatched.length) { console.log(`MISMATCHED: ${mismatched.join(', ')}`); process.exitCode = 1 }
    else console.log('every collection matched the snapshot')
  } finally { await client.close() }
}

async function list() {
  try {
    const files = (await readdir(DIR)).filter(f => f.endsWith('.ejson.gz')).sort().reverse()
    if (!files.length) return console.log('no snapshots yet')
    console.log(`snapshots in ${DIR}\n`)
    for (const f of files) {
      const s = await stat(join(DIR, f))
      console.log(`  ${(s.size / 1024).toFixed(0).padStart(6)} KB  ${f}`)
    }
  } catch { console.log('no snapshots yet') }
}

if (cmd === 'dump')         await dump(arg('db', 'lms_live_copy'))
else if (cmd === 'restore') await restore(arg('db', 'lms_working'), arg('file'))
else if (cmd === 'list')    await list()
else {
  console.log('bun src/scripts/db-snapshot.ts dump    --db=lms_live_copy')
  console.log('bun src/scripts/db-snapshot.ts restore --db=lms_working --file=<path> [--drop]')
  console.log('bun src/scripts/db-snapshot.ts list')
}
process.exit(process.exitCode ?? 0)
