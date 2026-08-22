/* ─────────────────────────────────────────────────────
   setup-r2-cors.ts — apply the browser CORS policy to the R2 media bucket.

   WHY THIS EXISTS
   Two upload paths reach R2, and only one of them is same-origin:

     images  →  browser → backend (multipart /uploads/image) → R2
     videos  →  browser → R2 DIRECTLY, via a presigned PUT

   The video path is cross-origin, so the browser sends a CORS preflight
   (OPTIONS) to the bucket first. A bucket with no CORS policy answers 403
   and the upload dies before a byte moves — images keep working, videos
   never start. That is exactly the failure this script fixes.

   Access control is unaffected: every PUT still requires a valid 1-hour
   presigned signature minted by the authenticated backend. CORS only tells
   the browser it may attempt the request it was already authorised to make.

   Run once per bucket (idempotent — re-running just re-applies the rules):
     bun src/scripts/setup-r2-cors.ts            # show + apply
     bun src/scripts/setup-r2-cors.ts --dry-run  # show only

   The KYC bucket is deliberately NOT touched: nothing uploads to it from a
   browser, and it must stay closed.
───────────────────────────────────────────────────── */
import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { env } from '@/config/env.ts'

const dryRun = process.argv.includes('--dry-run')

if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
  console.error('R2 is not configured in this environment — nothing to do.')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
})
const Bucket = env.R2_BUCKET_NAME

/* '*' because the app is served from several origins (localhost dev ports,
   the admin and client production hosts). Narrow this to an explicit list if
   you would rather pin it — the signature, not the origin, is the guard. */
const CORSRules = [{
  AllowedOrigins: ['*'],
  AllowedMethods: ['PUT', 'GET', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders:  ['ETag'],
  MaxAgeSeconds:  3600,
}]

try {
  const current = await s3.send(new GetBucketCorsCommand({ Bucket }))
  console.log(`current CORS on ${Bucket}:`, JSON.stringify(current.CORSRules))
} catch (err) {
  console.log(`current CORS on ${Bucket}: none (${(err as { name?: string }).name ?? 'error'})`)
}

if (dryRun) {
  console.log('--dry-run: would apply', JSON.stringify(CORSRules))
  process.exit(0)
}

await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules } }))
console.log(`✅  CORS applied to ${Bucket} — browser presigned video uploads will now pass preflight.`)
