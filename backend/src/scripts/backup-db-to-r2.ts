/* ─────────────────────────────────────────────────────
   Back the LMS database up to R2.

   Reads a MongoDB database, writes ONE gzipped canonical-EJSON object to
   lms-delta under backups/lms/. The only write it performs is that PUT —
   nothing is deleted or overwritten, because every key carries a timestamp.

   Canonical EJSON, not JSON.stringify: plain JSON turns ObjectId into a
   string and Date into text, so a restore produces documents whose _id no
   longer matches any reference and whose dates sort alphabetically. It looks
   like it worked until relationships break. EJSON round-trips every BSON type.

   The source is READ-ONLY. Safe to point at production.

   Usage
     BACKUP_SOURCE_URI='mongodb://user:pass@host:27017/lms?authSource=admin' \
       bun src/scripts/backup-db-to-r2.ts

     --prefix=backups/lms/   where it lands (default)
     --dry-run               build the archive, print the size, upload nothing

   Restore with db-snapshot.ts once the file is pulled back down by lms-r2.ts.
───────────────────────────────────────────────────── */
import { MongoClient } from 'mongodb'
import { EJSON } from 'bson'
import { gzipSync } from 'zlib'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { env } from '@/config/env.ts'

const arg = (n: string, d = '') =>
  process.argv.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d

const SOURCE = process.env['BACKUP_SOURCE_URI'] ?? ''
const PREFIX = arg('prefix', 'backups/lms/')
const DRY    = process.argv.includes('--dry-run')
const BUCKET = env.R2_BUCKET_NAME                     // lms-delta

if (!SOURCE) {
  console.error('Set BACKUP_SOURCE_URI to the database you want backed up.')
  process.exit(1)
}
/* The KYC bucket is for identity documents and nothing else. A database dump
   contains every user record; it does not belong in a store whose whole point
   is a narrow, auditable purpose. */
if (BUCKET !== env.R2_BUCKET_NAME || /kyc/i.test(BUCKET)) {
  console.error(`Refusing to write a database dump to "${BUCKET}".`)
  process.exit(1)
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(2)
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16) // YYYY-MM-DDTHH-mm

const mongo = new MongoClient(SOURCE, { serverSelectionTimeoutMS: 20_000 })
await mongo.connect()

let key = ''
let gz: Buffer
try {
  const db = mongo.db()
  const names = (await db.listCollections().toArray())
    .map(c => c.name).filter(n => !n.startsWith('system.')).sort()

  console.log(`source : ${db.databaseName}  (read-only)`)
  const collections: Record<string, unknown[]> = {}
  let total = 0
  for (const n of names) {
    const docs = await db.collection(n).find({}).toArray()
    collections[n] = docs
    total += docs.length
    if (docs.length) console.log(`  ${String(docs.length).padStart(6)}  ${n}`)
  }

  const body = EJSON.stringify(
    { db: db.databaseName, takenAt: new Date().toISOString(), documents: total, collections },
    { relaxed: false },
  )
  gz  = gzipSync(Buffer.from(body, 'utf8'))
  key = `${PREFIX}${db.databaseName}_${stamp}.ejson.gz`

  console.log(`\ncollections : ${names.length}`)
  console.log(`documents   : ${total}`)
  console.log(`archive     : ${mb(gz.length)} MB gzipped`)
} finally {
  await mongo.close()
}

if (DRY) {
  console.log(`\n--dry-run: would upload to ${BUCKET}/${key}`)
  process.exit(0)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  },
})

await s3.send(new PutObjectCommand({
  Bucket: BUCKET,
  Key: key,
  Body: gz,
  ContentType: 'application/gzip',
  /* Metadata travels with the object, so what it contains is answerable
     without downloading and unzipping it first. */
  Metadata: { 'taken-at': new Date().toISOString(), 'source-db': 'lms' },
}))

/* Trust the PUT's success only after R2 agrees the object exists at the size
   we sent. A silently truncated upload still returns 200. */
const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
const ok = head.ContentLength === gz.length
console.log(`\nuploaded : ${BUCKET}/${key}`)
console.log(`verified : ${ok ? 'yes' : 'NO'}  (sent ${gz.length} bytes, R2 reports ${head.ContentLength})`)
if (!ok) { console.error('Size mismatch — treat this backup as unusable.'); process.exit(1) }
process.exit(0)
