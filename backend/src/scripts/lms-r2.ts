/* ─────────────────────────────────────────────────────
   R2 tooling for the LMS — and ONLY the LMS.

   These credentials can see six buckets belonging to different products
   (backoffice, hrms, support-miles, trading-crm as well as ours). A general
   purpose R2 script on this key is a foot-gun: one mistyped flag pulls down
   another team's database dump or HR face-recognition images. So the bucket
   list here is a hard allow-list, not a default — anything else is refused.

   READ-ONLY on R2. Lists and gets only; never puts, never deletes.

   Commands
     list                       inventory both LMS buckets
     list   --prefix=documents/ inventory one prefix
     fetch  --prefix=…          download the NEWEST object under a prefix
     sync   --prefix=…          download EVERYTHING under a prefix

   Flags
     --bucket=lms-delta|lms-delta-kyc   (default: lms-delta)
     --keep=N        with `fetch`, take the newest N (default 1)
     --out=DIR       destination (default .logs/r2-lms, gitignored)
     --include-kyc   required to touch lms-delta-kyc at all — see below

   Why KYC needs an extra flag: that bucket holds passports and national IDs
   (H-11). Nothing serves it publicly and it should stay that way; copying it
   onto a laptop turns a controlled store into an uncontrolled one. The flag
   exists so that can never happen by momentum.
───────────────────────────────────────────────────── */
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { createWriteStream } from 'fs'
import { mkdir, stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import type { Readable } from 'stream'
import { env } from '@/config/env.ts'

const MEDIA_BUCKET = env.R2_BUCKET_NAME                                  // lms-delta
const KYC_BUCKET   = process.env['R2_KYC_BUCKET_NAME'] ?? 'lms-delta-kyc'
const ALLOWED      = new Set([MEDIA_BUCKET, KYC_BUCKET])

const cmd = process.argv[2] ?? 'list'
const arg = (n: string, d = '') =>
  process.argv.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d

const BUCKET      = arg('bucket', MEDIA_BUCKET)
const PREFIX      = arg('prefix', '')
const KEEP        = Math.max(1, Number(arg('keep', '1')))
const OUT         = arg('out', join(process.cwd(), '.logs', 'r2-lms'))
const INCLUDE_KYC = process.argv.includes('--include-kyc')

if (!ALLOWED.has(BUCKET)) {
  console.error(`Refused: "${BUCKET}" is not an LMS bucket.`)
  console.error(`This script only touches: ${[...ALLOWED].join(', ')}`)
  process.exit(1)
}
if (BUCKET === KYC_BUCKET && !INCLUDE_KYC) {
  console.error(`Refused: ${KYC_BUCKET} holds identity documents (passports, national IDs).`)
  console.error('Pass --include-kyc if you genuinely intend to copy them locally.')
  process.exit(1)
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  },
})

const mb = (n = 0) => (n / 1024 / 1024).toFixed(2)

type Obj = { Key?: string; Size?: number; LastModified?: Date }

/** Every object under a prefix — ListObjectsV2 caps at 1000 per page. */
async function listAll(bucket: string, prefix: string): Promise<Obj[]> {
  const out: Obj[] = []
  let token: string | undefined
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token,
    }))
    out.push(...(page.Contents ?? []))
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return out.filter(o => o.Key && !o.Key.endsWith('/'))
}

/** Newest first — by the object's own timestamp, never by filename. A naming
    change would silently reorder a lexical sort; LastModified will not. */
const newestFirst = (a: Obj[]) =>
  a.filter(o => o.LastModified).sort((x, y) => +y.LastModified! - +x.LastModified!)

async function download(bucket: string, objs: Obj[]) {
  await mkdir(OUT, { recursive: true })
  let failed = 0
  for (const o of objs) {
    /* Mirror the key's folder structure so documents/x.jpg and images/x.jpg
       cannot collide into one file. */
    const dest = join(OUT, bucket, o.Key!)
    await mkdir(dirname(dest), { recursive: true })
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: o.Key! }))
    await pipeline(res.Body as Readable, createWriteStream(dest))

    /* A truncated download still looks like a file. Compare bytes on disk
       against the size R2 reported for the object. */
    const got = (await stat(dest)).size
    const ok  = got === (o.Size ?? -1)
    if (!ok) failed++
    console.log(`  ${ok ? 'ok  ' : 'BAD '} ${mb(got).padStart(9)} MB  ${o.Key}`)
    if (!ok) console.error(`       expected ${o.Size} bytes, wrote ${got} — unusable`)
  }
  console.log(failed ? `\n${failed} file(s) failed verification` : `\nall ${objs.length} verified against their R2 size`)
  if (failed) process.exitCode = 1
}

if (cmd === 'list') {
  const buckets = BUCKET === MEDIA_BUCKET && !PREFIX && !INCLUDE_KYC
    ? [MEDIA_BUCKET]           // KYC stays out of a default inventory
    : [BUCKET]
  for (const b of buckets) {
    const top = await client.send(new ListObjectsV2Command({
      Bucket: b, Prefix: PREFIX, Delimiter: '/', MaxKeys: 200,
    }))
    const all = await listAll(b, PREFIX)
    const bytes = all.reduce((s, o) => s + (o.Size ?? 0), 0)
    console.log(`── ${b}${PREFIX ? ` /${PREFIX}` : ''}`)
    console.log(`   prefixes : ${(top.CommonPrefixes ?? []).map(p => p.Prefix).join('  ') || '(none)'}`)
    console.log(`   objects  : ${all.length}   total ${mb(bytes)} MB`)
    newestFirst(all).slice(0, 8).forEach(o =>
      console.log(`     ${o.LastModified!.toISOString()}  ${mb(o.Size).padStart(9)} MB  ${o.Key}`))
    console.log('')
  }
} else if (cmd === 'fetch') {
  if (!PREFIX) { console.error('fetch needs --prefix='); process.exit(1) }
  const picked = newestFirst(await listAll(BUCKET, PREFIX)).slice(0, KEEP)
  if (!picked.length) { console.error(`nothing under ${BUCKET}/${PREFIX}`); process.exit(1) }
  console.log(`newest ${picked.length} from ${BUCKET}/${PREFIX} -> ${OUT}\n`)
  await download(BUCKET, picked)
} else if (cmd === 'sync') {
  if (!PREFIX) { console.error('sync needs --prefix= (refusing to pull a whole bucket by accident)'); process.exit(1) }
  const all = await listAll(BUCKET, PREFIX)
  const bytes = all.reduce((s, o) => s + (o.Size ?? 0), 0)
  console.log(`${all.length} object(s), ${mb(bytes)} MB from ${BUCKET}/${PREFIX} -> ${OUT}\n`)
  await download(BUCKET, all)
} else {
  console.log('bun src/scripts/lms-r2.ts list  [--bucket=…] [--prefix=…]')
  console.log('bun src/scripts/lms-r2.ts fetch  --prefix=… [--keep=N]')
  console.log('bun src/scripts/lms-r2.ts sync   --prefix=…')
  console.log(`\nbuckets allowed: ${[...ALLOWED].join(', ')}`)
}
process.exit(process.exitCode ?? 0)
