/**
 * H-11 / N-06 — prove, from outside, whether identity scans are reachable.
 *
 *   bun run verify-kyc
 *
 * This finding sat open with "needs a Cloudflare console check" against it,
 * which is a poor place for the most sensitive data in the system to live:
 * nobody re-runs a console check in CI, and a setting flipped six months from
 * now goes unnoticed. Most of it is observable — so observe it.
 *
 * Every remote request below is an UNAUTHENTICATED GET: exactly what an
 * outsider holding a leaked URL would send. Read-only throughout; nothing is
 * written, moved or deleted. S3 credentials are used only for HeadObject and
 * ListObjectsV2, to establish what actually exists.
 *
 * ── The control matters more than the probes ──
 * The first version of this script reported a clean bill of health because
 * every probe came back 404. Two of those 404s were objects that DO NOT EXIST,
 * and one was a bucket with no public hostname — none of it evidence that
 * access control works. A probe that cannot tell "refused" from "not there"
 * proves nothing. So this now:
 *   1. probes a known-PUBLIC object first, which MUST come back 200/206,
 *      otherwise the whole run is INCONCLUSIVE rather than green;
 *   2. checks existence over the S3 API before interpreting any 404.
 *
 * Exit codes: 0 clean · 1 something is reachable · 2 inconclusive.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { S3Client, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { env } from '@/config/env.ts'
import { UserModel } from '@/models/schema.ts'
import { isR2Configured, isKycStoragePrivate, keyFromUrl, KYC_PREFIX, kycBucket } from '@/services/r2.service.ts'

const FIELDS = ['passportUrl', 'idDocUrl'] as const
const line = (s = '') => console.log(s)

let exposed = 0        /* something answered to an anonymous caller */
let inconclusive = 0   /* something could not be established either way */

/* ── An unauthenticated GET, range-limited so a hit never pulls a whole file ── */
async function fetchAnon(url: string): Promise<{ ok: boolean; status: number | string; type?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET', headers: { range: 'bytes=0-63' },
      redirect: 'follow', signal: AbortSignal.timeout(15_000),
    })
    return { ok: res.status === 200 || res.status === 206, status: res.status, type: res.headers.get('content-type') ?? undefined }
  } catch (err) {
    const e = err as Error
    return { ok: false, status: e.name === 'TimeoutError' ? 'timeout' : e.message.slice(0, 50) }
  }
}

async function main() {
  line('\n🔐  KYC exposure check — unauthenticated probes, nothing is written\n')

  /* ── 1. Configuration ─────────────────────────────────────────── */
  line('  Configuration')
  if (!isR2Configured()) {
    line('    storage: local disk (R2 not configured) — kyc/ is blocked by the static handler in app.ts.')
    line('    Nothing remote to probe.\n')
    process.exit(0)
  }
  const dedicated = process.env['R2_KYC_BUCKET_NAME']?.trim() ?? ''
  const publicBase = (env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '')
  line(`    media bucket:     ${env.R2_BUCKET_NAME}`)
  line(`    KYC bucket:       ${dedicated || '(unset)'}`)
  line(`    public base URL:  ${publicBase || '(unset)'}`)
  line(`    separate buckets: ${isKycStoragePrivate() ? 'YES' : 'NO'}`)
  if (!isKycStoragePrivate() || kycBucket() === env.R2_BUCKET_NAME) {
    line('    ❌ Identity scans share the bucket that R2_PUBLIC_URL serves.')
    exposed++
  }
  line()

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  })
  const exists = async (bucket: string, key: string): Promise<boolean> => {
    try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true } catch { return false }
  }

  /* ── 2. What the database points at ───────────────────────────── */
  await mongoose.connect(env.DATABASE_URL, { serverSelectionTimeoutMS: 5_000, authSource: 'admin' })
  const users = await UserModel.find({
    $or: FIELDS.map(f => ({ [`enrollmentApplication.${f}`]: { $exists: true, $ne: '' } })),
  }).select('email enrollmentApplication').lean().exec()

  const gated: string[] = []
  const legacy: { owner: string; key: string }[] = []
  let placeholders = 0

  for (const user of users) {
    const app = (user as unknown as { enrollmentApplication?: Record<string, string> }).enrollmentApplication
    if (!app) continue
    for (const field of FIELDS) {
      const value = app[field]
      if (!value) continue
      const key = keyFromUrl(value)
      if (key?.startsWith(KYC_PREFIX)) { gated.push(key); continue }
      if (!key || !key.includes('/') || !/\.[a-z0-9]{2,5}$/i.test(key)) { placeholders++; continue }
      legacy.push({ owner: `${user.email}:${field}`, key })
    }
  }

  const inv = await s3.send(new ListObjectsV2Command({ Bucket: kycBucket(), MaxKeys: 1000 }))
  const kycObjects = (inv.Contents ?? []).map(o => o.Key!)
  const strayInKyc = kycObjects.filter(k => !k.startsWith(KYC_PREFIX))

  line('  Stored references')
  line(`    gated (kyc/ keys):  ${gated.length}`)
  line(`    legacy (public):    ${legacy.length}`)
  line(`    stale placeholders: ${placeholders}  (never were storage keys)`)
  line(`    objects in ${kycBucket()}: ${kycObjects.length}${strayInKyc.length ? `  (${strayInKyc.length} outside kyc/)` : ''}`)
  line()

  /* ── 3. The control. Without this, every 404 below is meaningless ── */
  line('  Control — a known-PUBLIC object must answer, or this run proves nothing')
  let controlOk = false
  if (publicBase) {
    const anyPublic = await UserModel.findOne({
      avatarUrl: { $regex: '^' + publicBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
    }).select('avatarUrl').lean()
    const url = (anyPublic as unknown as { avatarUrl?: string } | null)?.avatarUrl
    if (!url) {
      line('    ⚠️  no object is stored under the public base URL, so the public path')
      line('        cannot be exercised. Treating the probes below as INCONCLUSIVE.')
      inconclusive++
    } else {
      const r = await fetchAnon(url)
      controlOk = r.ok
      line(`    ${r.ok ? '✅' : '⚠️ '} public avatar → ${r.status}${r.type ? ` · ${r.type}` : ''}`)
      if (!r.ok) {
        line('        The public hostname is not serving. Every 404 below would be')
        line('        explained by that alone — INCONCLUSIVE, not clean.')
        inconclusive++
      }
    }
  } else {
    line('    ⚠️  R2_PUBLIC_URL is unset — nothing to control against.')
    inconclusive++
  }
  line()

  /* ── 4. Probes, each interpreted against whether the object exists ── */
  line('  Unauthenticated probes')

  const probe = async (label: string, url: string, bucket: string, key: string) => {
    const there = await exists(bucket, key)
    const r = await fetchAnon(url)
    if (r.ok) {
      line(`    ❌ REACHABLE  ${label}`)
      line(`                  ${url}  (${r.status}${r.type ? ` · ${r.type}` : ''})`)
      exposed++
      return
    }
    if (!there) {
      line(`    ⚪ n/a        ${label} — ${r.status}, but the object does not exist in ${bucket}`)
      line('                  (a dangling reference, not a closed door — proves nothing)')
      return
    }
    line(`    ✅ refused    ${label}  (${r.status}, object exists in ${bucket})`)
  }

  if (publicBase) {
    for (const l of legacy)              await probe(`legacy  ${l.owner}`, `${publicBase}/${l.key}`, env.R2_BUCKET_NAME, l.key)
    for (const key of kycObjects.slice(0, 5)) await probe(`gated   ${key}`, `${publicBase}/${key}`, kycBucket(), key)
  }

  /* Our own backend must never serve kyc/ statically — P-23 covers the
     case-insensitive variant, which a case-insensitive filesystem would
     otherwise let through. */
  const backend = (env.BACKEND_PUBLIC_URL ?? '').replace(/\/+$/, '')
  if (backend && kycObjects.length > 0) {
    for (const path of [kycObjects[0]!, kycObjects[0]!.replace(/^kyc\//i, 'KYC/')]) {
      const r = await fetchAnon(`${backend}/uploads/${path}`)
      if (r.ok) { line(`    ❌ REACHABLE  static ${backend}/uploads/${path}`); exposed++ }
      else      { line(`    ✅ refused    static /uploads/${path}  (${r.status})`) }
    }
  }
  line()

  /* ── 5. Verdict, including what this cannot settle ─────────────── */
  if (exposed > 0) {
    line(`  ❌ ${exposed} problem(s). Identity documents answer to callers with no credentials.`)
  } else if (inconclusive > 0) {
    line('  ⚠️  INCONCLUSIVE — the control did not pass, so the refusals above are not evidence.')
  } else {
    line('  ✅ Nothing reachable. Identity scans live in a bucket the public hostname does not serve,')
    line('     and the app refuses to serve kyc/ statically in either case.')
  }

  if (legacy.length > 0) {
    line(`\n  ${legacy.length} reference(s) still point outside kyc/. Run \`bun run migrate-kyc\` for detail.`)
  }

  line('\n  What this CANNOT establish, and why:')
  line(`     whether ${kycBucket()} has its own managed r2.dev URL enabled.`)
  line('     That hostname is a random per-bucket id, not derivable from anything here,')
  line('     and the S3 API does not expose the setting. Settle it in the Cloudflare')
  line('     console (R2 → bucket → Settings → Public access) or with an API token:')
  line(`     GET /accounts/${env.R2_ACCOUNT_ID}/r2/buckets/${kycBucket()}/domains/managed`)
  line()

  await mongoose.disconnect()
  process.exit(exposed > 0 ? 1 : inconclusive > 0 ? 2 : 0)
}

main().catch(err => {
  console.error('KYC verification failed:', err)
  process.exit(1)
})
