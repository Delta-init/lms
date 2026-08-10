/**
 * HLS Transcoding Service
 * ────────────────────────
 * Downloads an MP4 from R2, transcodes it to HLS at 3 quality levels
 * (360p / 720p / 1080p) using FFmpeg, uploads all segments + manifests
 * back to R2, and returns the public URL of master.m3u8.
 *
 * Output R2 layout:
 *   hls/{baseKey}/master.m3u8
 *   hls/{baseKey}/stream_0.m3u8   (1080p)
 *   hls/{baseKey}/stream_1.m3u8   (720p)
 *   hls/{baseKey}/stream_2.m3u8   (360p)
 *   hls/{baseKey}/stream_0_000.ts  ...
 */

import { exec }        from 'child_process'
import { promisify }   from 'util'
import fs              from 'fs'
import path            from 'path'
import os              from 'os'
import crypto          from 'crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline }    from 'node:stream/promises'
import { env }         from '@/config/env.ts'
import { uploadToR2, getPublicUrl } from '@/services/r2.service.ts'

const execAsync = promisify(exec)

/* ── Resource ceilings ────────────────────────────────────────
   The source streams to disk rather than into the heap, so a job's
   resident cost is the encode itself. Both the input size and the
   number of simultaneous jobs are still capped: each job is a 3-rung
   libx264 encode and the segments land on local disk.
──────────────────────────────────────────────────────────────── */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
const MAX_CONCURRENT   = 2

let activeJobs = 0

/* ── helpers ──────────────────────────────────────────────────── */
function tmpDir(): string {
  const id  = crypto.randomBytes(8).toString('hex')
  const dir = path.join(os.tmpdir(), `hls-${id}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

/** Upload every file inside localDir to R2 under r2Prefix/ */
async function uploadDir(localDir: string, r2Prefix: string): Promise<void> {
  const files = fs.readdirSync(localDir)
  await Promise.all(
    files.map(async (file) => {
      const localPath = path.join(localDir, file)
      const r2Key     = `${r2Prefix}/${file}`
      const buf       = fs.readFileSync(localPath)

      // Pick correct MIME for HLS files
      const mime = file.endsWith('.m3u8')
        ? 'application/x-mpegURL'
        : file.endsWith('.ts')
          ? 'video/MP2T'
          : 'application/octet-stream'

      await uploadToR2(buf, r2Key, mime)
    }),
  )
}

/* ── main export ──────────────────────────────────────────────── */
/**
 * @param sourceKey  R2 key of the source MP4 (e.g. "videos/123-abc.mp4")
 * @returns          Public CDN URL of master.m3u8
 */
export async function transcodeToHLS(sourceKey: string): Promise<string> {
  if (activeJobs >= MAX_CONCURRENT) {
    throw new Error(`Transcoder busy — ${MAX_CONCURRENT} jobs are already running. Please retry shortly.`)
  }

  const workDir  = tmpDir()
  const inputPath = path.join(workDir, 'input.mp4')

  activeJobs++
  try {
    /* 1 ── Download source video from R2 CDN ──────────────────── */
    const sourceUrl = getPublicUrl(sourceKey)
    const res = await fetch(sourceUrl)
    if (!res.ok) throw new Error(`Failed to download source video: ${res.status} ${res.statusText}`)

    const declaredBytes = Number(res.headers.get('content-length') ?? 0)
    if (declaredBytes > MAX_SOURCE_BYTES) {
      throw new Error(`Source video is too large to transcode (${declaredBytes} bytes, limit ${MAX_SOURCE_BYTES}).`)
    }
    if (!res.body) throw new Error('Source video response had no body')

    /* Stream to disk instead of buffering. content-length above is only
       advisory — a source can understate or omit it — so the cap is also
       enforced on bytes actually received, and the transfer is aborted the
       moment it is exceeded. Everything downstream still reads inputPath. */
    let received = 0
    const capToLimit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        if (received > MAX_SOURCE_BYTES) {
          cb(new Error(`Source video exceeds the transcode limit of ${MAX_SOURCE_BYTES} bytes.`))
          return
        }
        cb(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      capToLimit,
      fs.createWriteStream(inputPath),
    )

    /* 2 ── Probe video to decide which quality levels to include ── */
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v quiet -select_streams v:0 -show_entries stream=height -of csv=p=0 "${inputPath}"`,
    )
    const sourceHeight = parseInt(probeOut.trim(), 10) || 1080

    /* Probe for audio — some videos are video-only (no audio track) */
    const { stdout: audioOut } = await execAsync(
      `ffprobe -v quiet -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "${inputPath}"`,
    )
    const hasAudio = audioOut.trim().length > 0

    // Build quality ladder (only include levels ≤ source height)
    const allLevels = [
      { label: '1080p', height: 1080, vBitrate: '4000k', aBitrate: '192k' },
      { label: '720p',  height: 720,  vBitrate: '2000k', aBitrate: '128k' },
      { label: '360p',  height: 360,  vBitrate:  '800k', aBitrate:  '96k' },
    ]
    const levels = allLevels.filter(l => l.height <= sourceHeight + 80) // +80 = allow slight upscale
    if (levels.length === 0) levels.push(allLevels[allLevels.length - 1]!)

    /* 3 ── Build FFmpeg command ───────────────────────────────── */
    const nLevels = levels.length

    // filter_complex: split input video into N streams and scale each
    const splitFilter = `[0:v]split=${nLevels}${levels.map((_, i) => `[v${i}]`).join('')}`
    const scaleFilters = levels.map((l, i) => `[v${i}]scale=-2:${l.height}[v${i}out]`).join('; ')
    const filterComplex = `"${splitFilter}; ${scaleFilters}"`

    // Per-stream map + encode options (skip audio args when source has no audio)
    // Use 0:a:0? (first audio stream only) to avoid issues with multi-audio-track sources
    const streamArgs = levels.flatMap((l, i) => [
      `-map [v${i}out]`,
      ...(hasAudio ? [`-map 0:a:0?`] : []),
      `-c:v:${i} libx264 -b:v:${i} ${l.vBitrate} -maxrate:${i} ${l.vBitrate} -bufsize:${i} ${parseInt(l.vBitrate) * 2}k`,
      ...(hasAudio ? [`-c:a:${i} aac -b:a:${i} ${l.aBitrate}`] : []),
    ]).join(' ')

    const varStreamMap = levels.map((_, i) => hasAudio ? `v:${i},a:${i}` : `v:${i}`).join(' ')

    const segmentPath = path.join(workDir, 'stream_%v_%03d.ts')
    const playlistPath = path.join(workDir, 'stream_%v.m3u8')

    const ffmpegCmd = [
      'ffmpeg -y',
      `-i "${inputPath}"`,
      `-filter_complex ${filterComplex}`,
      streamArgs,
      '-f hls',
      '-hls_time 6',
      '-hls_playlist_type vod',
      '-hls_flags independent_segments',
      `-master_pl_name master.m3u8`,
      `-var_stream_map "${varStreamMap}"`,
      `-hls_segment_filename "${segmentPath}"`,
      `"${playlistPath}"`,
    ].join(' ')

    await execAsync(ffmpegCmd, { maxBuffer: 100 * 1024 * 1024 }) // 100 MB buffer for large outputs

    /* 4 ── Determine R2 prefix from source key ────────────────── */
    // e.g. "videos/1234-abc.mp4" → "hls/videos/1234-abc"
    const withoutExt = sourceKey.replace(/\.[^.]+$/, '')
    const r2Prefix   = `hls/${withoutExt}`

    /* 5 ── Upload all generated files to R2 ──────────────────── */
    await uploadDir(workDir, r2Prefix)

    /* 6 ── Return public URL of master.m3u8 ──────────────────── */
    return getPublicUrl(`${r2Prefix}/master.m3u8`)

  } finally {
    cleanDir(workDir)
    activeJobs--
  }
}
