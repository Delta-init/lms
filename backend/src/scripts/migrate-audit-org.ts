/**
 * H-12 — backfill `organizationId` onto existing audit-log entries.
 *
 *   bun run migrate-audit-org            # report only, changes nothing
 *   bun run migrate-audit-org --apply    # write
 *
 * The audit trail records actorEmail, ip, userAgent and arbitrary meta, so an
 * academy admin should only see their own. Entries written before the field
 * existed carry none, and the repository deliberately leaves those visible to
 * everyone rather than hiding history. This stamps them from the actor's own
 * record so the scoping becomes meaningful.
 *
 * Entries by a super_admin are left global on purpose — that account is not
 * scoped to an academy, and attributing its actions to one would be wrong.
 *
 * Idempotent: rows that already carry the field are skipped, so it is safe to
 * re-run after more history accumulates.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import { AuditLogModel, UserModel } from '@/models/schema.ts'

const APPLY = process.argv.includes('--apply')

async function main() {
  await mongoose.connect(env.DATABASE_URL, { serverSelectionTimeoutMS: 5_000, authSource: 'admin' })
  console.log(`\n🗂️   Audit-log tenancy backfill — ${APPLY ? 'APPLY' : 'DRY RUN (use --apply to write)'}\n`)

  const total   = await AuditLogModel.countDocuments()
  const pending = await AuditLogModel.countDocuments({ organizationId: { $exists: false } })
  console.log(`    entries: ${total}   already stamped: ${total - pending}   to consider: ${pending}\n`)

  if (pending === 0) {
    console.log('    Nothing to do.\n')
    await mongoose.disconnect()
    return
  }

  /* One lookup per distinct actor rather than per row. */
  const actorIds = await AuditLogModel.distinct('actorId', { organizationId: { $exists: false } })
  const actors   = await UserModel.find({ _id: { $in: actorIds } })
    .select('organizationId role email').lean()

  const orgByActor = new Map<string, string | null>()
  for (const a of actors) {
    const org = (a as { organizationId?: unknown }).organizationId
    orgByActor.set(String(a._id), (a as { role?: string }).role === 'super_admin' || !org ? null : String(org))
  }

  let stamped = 0, leftGlobal = 0, actorGone = 0
  for (const actorId of actorIds) {
    const key = String(actorId)
    const n   = await AuditLogModel.countDocuments({ actorId, organizationId: { $exists: false } })

    if (!orgByActor.has(key)) {
      console.log(`  ⚠️  actor ${key} no longer exists — ${n} entr${n === 1 ? 'y' : 'ies'} left global`)
      actorGone += n
      continue
    }
    const org = orgByActor.get(key)!
    if (!org) { leftGlobal += n; continue }        /* super_admin or no academy */

    console.log(`  → actor ${key}: ${n} entr${n === 1 ? 'y' : 'ies'} ⇒ org ${org.slice(-6)}`)
    if (APPLY) {
      const r = await AuditLogModel.updateMany(
        { actorId, organizationId: { $exists: false } },
        { $set: { organizationId: new mongoose.Types.ObjectId(org) } },
      )
      stamped += r.modifiedCount ?? 0
    } else {
      stamped += n
    }
  }

  console.log(`\n  ${APPLY ? 'stamped' : 'would stamp'}: ${stamped}   left global (super_admin / no academy): ${leftGlobal}   actor deleted: ${actorGone}`)
  if (!APPLY && stamped > 0) console.log('  Re-run with --apply to write.\n')
  else console.log('')

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('Audit backfill failed:', err)
  process.exit(1)
})
