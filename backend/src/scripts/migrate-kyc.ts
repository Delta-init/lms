/**
 * H-11 — relocate existing identity scans out of the public prefix.
 *
 *   bun run migrate-kyc            # report only, changes nothing
 *   bun run migrate-kyc --apply    # copy objects into kyc/ and rewrite the URLs
 *
 * Passport and national-ID scans were uploaded to `documents/`, which is served
 * publicly. This copies each one to `kyc/` (never served publicly) and points
 * the user record at the new location.
 *
 * The profile photo is left alone on purpose: it doubles as `avatarUrl` and is
 * rendered in ~47 places across both apps, so gating it would blank avatars
 * platform-wide.
 *
 * Copy-then-rewrite, never move: the original object is left in place so a
 * half-finished run cannot lose a document. Re-running is safe — rows already
 * pointing at kyc/ are skipped. Delete the old objects only once you have
 * confirmed the new links resolve.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import path from 'path'
import fs from 'fs/promises'
import { env } from '@/config/env.ts'
import { UserModel } from '@/models/schema.ts'
import {
  isR2Configured,
  keyFromUrl,
  copyToKycBucket,
  objectExists,
  isKycStoragePrivate,
  KYC_PREFIX,
} from '@/services/r2.service.ts'

const APPLY  = process.argv.includes('--apply')
/* Deletes references whose object is not in storage. Separate from --apply
   because it is a different action on a different problem: --apply relocates
   documents that exist, this removes pointers to documents that do not. */
const CLEAR_MISSING = process.argv.includes('--clear-missing')
const FIELDS = ['passportUrl', 'idDocUrl'] as const

/* ─── Destination key ───────────────────────────────
   Derived from the WHOLE source key, not its basename. Two users can hold the
   same filename — `documents/passport.jpg` appears more than once in this
   database — and a basename-only destination would land both on
   `kyc/passport.jpg`, silently overwriting one person's identity document
   with another's. Flattening the full key keeps it unique because the source
   key already was.
───────────────────────────────────────────────────── */
function destinationFor(sourceKey: string): string {
  return KYC_PREFIX + sourceKey.replace(/[/\\]/g, '_')
}

/** A key we can actually copy: a real stored object has a folder and a file
 *  extension. Values like "202" are stale placeholders, not storage keys. */
function looksLikeStorageKey(key: string): boolean {
  return key.includes('/') && /\.[a-z0-9]{2,5}$/i.test(key)
}

async function main() {
  await mongoose.connect(env.DATABASE_URL, {
    serverSelectionTimeoutMS: 5_000,
    authSource: 'admin',
  })
  const mode = APPLY ? 'APPLY' : CLEAR_MISSING ? 'CLEAR-MISSING (writes)' : 'DRY RUN (use --apply to write)'
  console.log(`\n🔐  KYC relocation — ${mode}`)
  console.log(`    storage: ${isR2Configured() ? 'Cloudflare R2' : 'local disk'}\n`)

  const users = await UserModel.find({
    $or: FIELDS.map(f => ({ [`enrollmentApplication.${f}`]: { $exists: true, $ne: '' } })),
  }).select('email enrollmentApplication').exec()

  let moved = 0, skipped = 0, failed = 0, unusable = 0, missing = 0, cleared = 0

  /* Pre-flight: refuse to run if two rows would land on the same object.
     A collision here means overwriting somebody's identity document, so it
     stops the migration rather than being reported afterwards. */
  const claims = new Map<string, string>()
  const collisions: string[] = []
  for (const user of users) {
    const a = (user as unknown as { enrollmentApplication?: Record<string, string> }).enrollmentApplication
    if (!a) continue
    for (const field of FIELDS) {
      const k = a[field] ? keyFromUrl(a[field]!) : null
      if (!k || k.startsWith(KYC_PREFIX) || !looksLikeStorageKey(k)) continue
      const dest  = destinationFor(k)
      const owner = `${user.email}:${field}`
      const prev  = claims.get(dest)
      if (prev && prev !== owner) collisions.push(`${dest}  ←  ${prev}  AND  ${owner}`)
      else claims.set(dest, owner)
    }
  }
  if (collisions.length > 0) {
    console.log('  ❌ Destination collisions — two records would share one object:\n')
    collisions.forEach(c => console.log(`     ${c}`))
    console.log('\n  Nothing was changed. Resolve these before running again.\n')
    await mongoose.disconnect()
    process.exit(1)
  }

  for (const user of users) {
    const app = (user as unknown as { enrollmentApplication?: Record<string, string> }).enrollmentApplication
    if (!app) continue

    const toUnset: string[] = []

    for (const field of FIELDS) {
      const url = app[field]
      if (!url) continue

      const key = keyFromUrl(url)
      if (!key) { console.log(`  ⚠️  ${user.email} ${field}: unrecognised URL, left alone`); skipped++; continue }
      if (key.startsWith(KYC_PREFIX)) { skipped++; continue }
      if (!looksLikeStorageKey(key)) {
        console.log(`  ⚠️  ${user.email} ${field}: "${key}" is not a storage key (stale placeholder?) — left alone`)
        unusable++; continue
      }

      const destKey = destinationFor(key)

      /* Is the object actually there? A reference whose object is GONE reads
         from the database exactly like one that simply has not been migrated,
         and the two mean opposite things: one is a broken link, the other is a
         document sitting in a public bucket. Reporting them together made a
         dry run say "would move 2" when neither could move, and would have
         counted both as failures on --apply. */
      if (isR2Configured() && !(await objectExists(key))) {
        console.log(`  ⚠️  ${user.email} ${field}: ${key} — NOT IN ${env.R2_BUCKET_NAME}; the reference is dangling, nothing to relocate`)
        missing++
        if (CLEAR_MISSING) toUnset.push(field)
        continue
      }

      console.log(`  → ${user.email} ${field}: ${key}  ⇒  ${destKey}`)

      if (!APPLY) { moved++; continue }

      try {
        if (isR2Configured()) {
          await copyToKycBucket(key, destKey)
          app[field] = destKey          /* bare key — not fetchable without authorisation */
        } else {
          const from = path.join(process.cwd(), 'uploads', key)
          const to   = path.join(process.cwd(), 'uploads', destKey)
          await fs.mkdir(path.dirname(to), { recursive: true })
          await fs.copyFile(from, to)
          app[field] = destKey
        }
        moved++
      } catch (err) {
        console.log(`     ❌ ${(err as Error).message}`)
        failed++
      }
    }

    if (APPLY) {
      user.markModified('enrollmentApplication')
      await user.save()
    }

    /* $unset, not `delete` on the subdocument.
       `enrollmentApplication` is a nested Schema, so what comes back is a
       Mongoose subdocument: assignment goes through its setter and is picked
       up by save(), but `delete subdoc.field` mutates nothing the change
       tracker can see. The first version of this did exactly that and reported
       "Cleared 2" while the database kept both values — a script that lies
       about having written is worse than one that fails. */
    if (CLEAR_MISSING && toUnset.length > 0) {
      const res = await UserModel.updateOne(
        { _id: user._id },
        { $unset: Object.fromEntries(toUnset.map(f => [`enrollmentApplication.${f}`, ''])) },
      )
      if (res.modifiedCount === 1) cleared += toUnset.length
      else console.log(`     ❌ ${user.email}: $unset matched ${res.matchedCount}, modified ${res.modifiedCount} — nothing was cleared`)
    }
  }

  console.log(`\n  ${APPLY ? 'moved' : 'would move'}: ${moved}   already gated: ${skipped}   not a storage key: ${unusable}   object missing: ${missing}   failed: ${failed}`)
  if (missing > 0 && !CLEAR_MISSING) {
    console.log(`\n  ${missing} reference(s) point at objects that are not in storage. They cannot be`)
    console.log('  relocated, and they are not an exposure — there is nothing there to expose.')
    console.log('  Re-run with --clear-missing to remove them, so the admin panel stops')
    console.log('  rendering a broken document link.')
  }
  if (cleared > 0) {
    console.log(`\n  Cleared ${cleared} dangling reference(s). The old values are printed above,`)
    console.log('  so a mistaken run is recoverable from this output.')
  }
  if (!APPLY && moved > 0) console.log('\n  Re-run with --apply to perform the move.\n')
  if (APPLY && moved > 0) {
    console.log('  Originals were left in place. Verify the new links resolve, then delete')
    console.log('  the old documents/ objects.\n')
  }

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('KYC migration failed:', err)
  process.exit(1)
})
