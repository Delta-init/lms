/* ─────────────────────────────────────────────────────
   Why does the admin panel show "Not submitted" for a document the student
   uploaded?

   Every identity document is a reference in the database plus an object in
   storage, and the two can disagree. The panel reads through
   GET /documents/:userId/:field, which answers 404 for several distinct
   reasons — nothing stored, an unreadable reference, an object that is not
   where the reference says it is. This walks every enrolment application and
   reports which of those each field is in.

   The bucket check is the point. Identity scans live in a SEPARATE private
   bucket named by R2_KYC_BUCKET_NAME. When that variable is unset,
   `kycBucket()` silently falls back to the main bucket — so scans can be
   signed against a bucket they were never written to, and every read 404s
   while the database looks perfectly healthy. Each key is therefore probed in
   BOTH buckets, and the report says where the object actually is.

   (Probing only the main bucket is exactly the mistake that produced a false
   "all 30 documents are broken" reading during diagnosis. Prefix decides the
   bucket; nothing else does.)

   READ ONLY. It opens no write, has no --apply, and touches nothing. Safe to
   run against production.

     bun run src/scripts/audit-identity-documents.ts            # problems only
     bun run src/scripts/audit-identity-documents.ts --all      # every student
     bun run src/scripts/audit-identity-documents.ts --csv      # machine-readable
───────────────────────────────────────────────────── */
import '@/config/timezone.ts'
import mongoose from 'mongoose'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { env } from '@/config/env.ts'
import { UserModel } from '@/models/schema.ts'
import {
  keyFromUrl, isR2Configured, objectExists,
  kycBucket, isKycStoragePrivate, KYC_PREFIX,
} from '@/services/r2.service.ts'
import { isValidDocumentRef } from '@/utils/documentRef.ts'

const SHOW_ALL = process.argv.includes('--all')
const AS_CSV   = process.argv.includes('--csv')

/** The document fields a reviewer sees on an enrolment request. */
const FIELDS = [
  { key: 'passportUrl', label: 'passport' },
  { key: 'idDocUrl',    label: 'idDoc'    },
  { key: 'photoUrl',    label: 'photo'    },
] as const

type Verdict =
  | 'not submitted'      // nothing stored — the panel is right to say so
  | 'ok'                 // stored, and the object is where it should be
  | 'wrong bucket'       // stored, object exists — in the OTHER bucket
  | 'object missing'     // stored, but no object anywhere we looked
  | 'foreign host'       // stored value points at somebody else's server
  | 'unreadable ref'     // stored value is not a key or a URL we recognise

interface Row {
  name: string; email: string; status: string
  field: string; verdict: Verdict; detail: string
}

/** Where a key is expected to live, given its prefix. */
function expectedBucket(key: string): string {
  return key.startsWith(KYC_PREFIX) ? kycBucket() : env.R2_BUCKET_NAME
}

async function existsOnDisk(key: string): Promise<boolean> {
  try { await access(path.join(process.cwd(), 'uploads', key)); return true }
  catch { return false }
}

async function classify(stored: unknown): Promise<{ verdict: Verdict; detail: string }> {
  if (stored === undefined || stored === null || stored === '') {
    return { verdict: 'not submitted', detail: '' }
  }
  const value = String(stored)

  /* A reference to a host that is not ours is not a missing object — nothing
     was ever stored here to go missing. keyFromUrl() would take the pathname
     and hand back a plausible-looking key ("200" from picsum.photos/200),
     which then reports as "object missing" and sends someone hunting for a
     file that never existed. Judged with the app's own rule so this cannot
     drift from what the API will accept. */
  if (/^https?:\/\//i.test(value) && !isValidDocumentRef(value)) {
    let host = value.slice(0, 46)
    try { host = new URL(value).host } catch { /* keep the raw prefix */ }
    return { verdict: 'foreign host', detail: host }
  }

  const key = keyFromUrl(value)
  if (!key) return { verdict: 'unreadable ref', detail: value.slice(0, 46) }

  if (!isR2Configured()) {
    return (await existsOnDisk(key))
      ? { verdict: 'ok', detail: 'local disk' }
      : { verdict: 'object missing', detail: `local disk · ${key.slice(0, 38)}` }
  }

  const want  = expectedBucket(key)
  const other = want === kycBucket() ? env.R2_BUCKET_NAME : kycBucket()

  if (await objectExists(key, want)) return { verdict: 'ok', detail: want }

  /* Not where it belongs — is it in the other bucket? That distinguishes a
     lost object from a misrouted lookup, and only the second is a config fix. */
  if (want !== other && await objectExists(key, other)) {
    return { verdict: 'wrong bucket', detail: `found in ${other}, expected ${want}` }
  }
  return { verdict: 'object missing', detail: `${want} · ${key.slice(0, 38)}` }
}

async function main(): Promise<void> {
  await mongoose.connect(env.DATABASE_URL)

  const dedicated = isKycStoragePrivate()
  if (!AS_CSV) {
    console.log(`\n  database        : ${mongoose.connection.db?.databaseName}`)
    console.log(`  storage         : ${isR2Configured() ? 'R2' : 'local disk'}`)
    console.log(`  main bucket     : ${env.R2_BUCKET_NAME}`)
    console.log(`  kyc bucket      : ${kycBucket()}${dedicated ? '' : '   (FALLBACK — R2_KYC_BUCKET_NAME is unset)'}`)
    console.log(`  R2_PUBLIC_URL   : ${env.R2_PUBLIC_URL ?? '(unset)'}`)
    if (!dedicated) {
      console.log(`
  ⚠  Identity scans have no dedicated bucket on this deployment.
     kycBucket() is falling back to the main bucket, so a scan written before
     the fallback — or by a deployment that HAD the variable set — is signed
     against a bucket it was never stored in, and every read answers 404 while
     the database looks correct. Any row below marked "wrong bucket" is that.`)
    }
    console.log()
  }

  const users = await UserModel.find(
    { enrollmentApplication: { $exists: true } },
    { name: 1, email: 1, enrollmentStatus: 1, enrollmentApplication: 1 },
  ).lean()

  const rows: Row[] = []
  const tally: Record<Verdict, number> = {
    'not submitted': 0, ok: 0, 'wrong bucket': 0, 'object missing': 0,
    'foreign host': 0, 'unreadable ref': 0,
  }

  for (const u of users) {
    const app = (u as { enrollmentApplication?: Record<string, unknown> }).enrollmentApplication ?? {}
    for (const f of FIELDS) {
      const { verdict, detail } = await classify(app[f.key])
      tally[verdict]++
      rows.push({
        name:   String(u.name ?? ''),
        email:  String(u.email ?? ''),
        status: String((u as { enrollmentStatus?: unknown }).enrollmentStatus ?? ''),
        field:  f.label, verdict, detail,
      })
    }
  }

  if (AS_CSV) {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    console.log('name,email,status,field,verdict,detail')
    for (const r of rows) {
      if (!SHOW_ALL && (r.verdict === 'ok' || r.verdict === 'not submitted')) continue
      console.log([r.name, r.email, r.status, r.field, r.verdict, r.detail].map(esc).join(','))
    }
    await mongoose.disconnect()
    return
  }

  const shown = rows.filter(r => SHOW_ALL || (r.verdict !== 'ok' && r.verdict !== 'not submitted'))

  if (!shown.length) {
    console.log('  Every stored document resolves. Nothing to chase.\n')
  } else {
    console.log(`  ${'student'.padEnd(26)}${'field'.padEnd(10)}${'verdict'.padEnd(16)}where`)
    console.log(`  ${''.padEnd(96, '-')}`)
    for (const r of shown.slice(0, 120)) {
      const who = (r.name || r.email).slice(0, 24)
      console.log(`  ${who.padEnd(26)}${r.field.padEnd(10)}${r.verdict.padEnd(16)}${r.detail}`)
    }
    if (shown.length > 120) console.log(`  … and ${shown.length - 120} more`)
  }

  console.log(`\n  ${users.length} application(s), ${rows.length} document slot(s)\n`)
  console.log(`    not submitted   ${String(tally['not submitted']).padStart(5)}   the panel is right to say so`)
  console.log(`    ok              ${String(tally.ok).padStart(5)}   stored and readable`)
  console.log(`    wrong bucket    ${String(tally['wrong bucket']).padStart(5)}   ${tally['wrong bucket'] ? 'CONFIG — set R2_KYC_BUCKET_NAME to the bucket named above' : ''}`)
  console.log(`    object missing  ${String(tally['object missing']).padStart(5)}   ${tally['object missing'] ? 'the upload did not land, or the object was removed' : ''}`)
  console.log(`    foreign host    ${String(tally['foreign host']).padStart(5)}   ${tally['foreign host'] ? 'points at another server — never stored here, re-upload required' : ''}`)
  console.log(`    unreadable ref  ${String(tally['unreadable ref']).padStart(5)}   ${tally['unreadable ref'] ? 'legacy or hand-written values — re-upload required' : ''}`)
  console.log(`\n  Anything other than "not submitted" or "ok" is a document the`)
  console.log(`  student sent that a reviewer cannot open.\n`)

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
