/**
 * backfill-video-durations.ts — set each video lesson's durationMins from the
 * ACTUAL video length (read with ffprobe over a signed URL), replacing the
 * manual/zero values.
 *
 *   bun src/scripts/backfill-video-durations.ts          # DRY RUN (no writes)
 *   bun src/scripts/backfill-video-durations.ts --yes    # apply
 *
 * Requires ffprobe on PATH. Reads only the video header (range requests), so
 * it does not download whole files. READ-only on R2; writes only durationMins.
 */
import mongoose from 'mongoose'
import { spawnSync } from 'node:child_process'
import { env } from '@/config/env.ts'
import { LessonModel } from '@/models/schema.ts'
import { keyFromUrl, generatePresignedGetUrl, isR2Configured } from '@/services/r2.service.ts'

const EXECUTE = process.argv.includes('--yes')

async function probeSeconds(url: string): Promise<number | null> {
  const proc = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    url,
  ], { encoding: 'utf8' })
  if (proc.status !== 0) return null
  const secs = parseFloat((proc.stdout ?? '').trim())
  return Number.isFinite(secs) && secs > 0 ? secs : null
}

async function main() {
  await mongoose.connect(env.DATABASE_URL)
  console.log(EXECUTE ? '⚠️  EXECUTE — durationMins will be updated' : '🔍 DRY RUN — no writes (pass --yes to apply)')

  const lessons = await LessonModel.find({ type: 'video', contentUrl: { $nin: [null, ''] } })
    .select('_id title durationMins contentUrl').lean()
  console.log(`Found ${lessons.length} video lesson(s)\n`)

  let updated = 0, skipped = 0, failed = 0
  for (const l of lessons as Array<{ _id: unknown; title?: string; durationMins?: number; contentUrl: string }>) {
    const key = keyFromUrl(l.contentUrl)
    const url = key && isR2Configured() ? await generatePresignedGetUrl(key, 600) : l.contentUrl
    const secs = await probeSeconds(url)
    if (secs == null) { failed++; console.log(`  ✗ probe failed: ${l.title}`); continue }

    const mins = Math.max(1, Math.round(secs / 60))
    const old  = l.durationMins ?? 0
    if (mins === old) { skipped++; continue }

    console.log(`  ${old}m → ${mins}m  (${Math.round(secs)}s)  ${l.title}`)
    if (EXECUTE) await LessonModel.updateOne({ _id: l._id }, { $set: { durationMins: mins } })
    updated++
  }

  console.log(`\n${EXECUTE ? 'Updated' : 'Would update'} ${updated}, unchanged ${skipped}, failed ${failed}.`)
  await mongoose.disconnect()
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
