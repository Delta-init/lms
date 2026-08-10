import Mux from '@mux/mux-node'
import crypto from 'node:crypto'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/* ── Singleton client ──────────────────────────────────── */
let _client: Mux | null = null

function getClient(): Mux {
  if (!_client) {
    if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
      throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set to use in-app streaming')
    }
    _client = new Mux({
      tokenId:     env.MUX_TOKEN_ID,
      tokenSecret: env.MUX_TOKEN_SECRET,
    })
  }
  return _client
}

export interface MuxStreamData {
  streamId:   string   // Mux live stream ID
  streamKey:  string   // RTMP stream key (keep secret)
  playbackId: string   // HLS playback ID (public)
}

/* RTMP ingest URL is the same for every Mux customer */
export const MUX_RTMP_URL = 'rtmps://global-live.mux.com:443/app'

/* Build student-facing HLS URL from playback ID */
export function buildPlaybackUrl(playbackId: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

/* Build recording playback URL from asset playback ID */
export function buildRecordingUrl(assetPlaybackId: string): string {
  return `https://stream.mux.com/${assetPlaybackId}.m3u8`
}

/* Mux thumbnail image URL */
export function buildThumbnailUrl(playbackId: string): string {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`
}

/* ── Create a new Mux live stream ─────────────────────── */
export async function createLiveStream(): Promise<MuxStreamData> {
  const mux = getClient()

  const stream = await mux.video.liveStreams.create({
    playback_policy:    ['public'],
    latency_mode:       'low',         // LL-HLS — ~2–4s latency
    reconnect_window:   60,            // wait 60s before ending if instructor drops
    new_asset_settings: {
      playback_policy: ['public'],     // recording is public after stream ends
      mp4_support:     'standard',     // enable MP4 download
    },
  })

  const playbackId = stream.playback_ids?.[0]?.id
  if (!playbackId) throw new Error('Mux did not return a playback ID')

  logger.info({ streamId: stream.id }, 'mux: live stream created')

  return {
    streamId:  stream.id,
    streamKey: stream.stream_key,
    playbackId,
  }
}

/* ── Delete a Mux live stream (cleanup) ───────────────── */
export async function deleteLiveStream(streamId: string): Promise<void> {
  try {
    const mux = getClient()
    await mux.video.liveStreams.delete(streamId)
    logger.info({ streamId }, 'mux: live stream deleted')
  } catch (err) {
    /* Log but don't throw — DB record deletion should still proceed */
    logger.warn({ err, streamId }, 'mux: failed to delete live stream (may already be deleted)')
  }
}

/* ── Enable a stream (instructor is about to go live) ─── */
export async function enableLiveStream(streamId: string): Promise<void> {
  const mux = getClient()
  await mux.video.liveStreams.enable(streamId)
  logger.info({ streamId }, 'mux: live stream enabled')
}

/* ── Disable a stream (instructor ended the session) ──── */
export async function disableLiveStream(streamId: string): Promise<void> {
  const mux = getClient()
  await mux.video.liveStreams.disable(streamId)
  logger.info({ streamId }, 'mux: live stream disabled')
}

/* ── Get a Mux asset (for recording URL) ─────────────── */
export async function getAssetPlaybackId(assetId: string): Promise<string | null> {
  try {
    const mux  = getClient()
    const asset = await mux.video.assets.retrieve(assetId)
    return asset.playback_ids?.[0]?.id ?? null
  } catch (err) {
    logger.warn({ err, assetId }, 'mux: failed to retrieve asset')
    return null
  }
}

/* ── Get current concurrent viewer count ─────────────
   Uses Mux Monitoring API — returns total live viewers
   across the environment (acceptable for single-stream LMS) */
export async function getLiveViewerCount(): Promise<number> {
  try {
    const mux  = getClient()
    const resp = await mux.data.monitoring.metrics.getBreakdown(
      'current-concurrent-viewers',
      { filters: ['stream_type:live'] },
    )
    return resp.data.reduce((sum, item) => sum + (item.concurrent_viewers ?? 0), 0)
  } catch (err) {
    logger.warn({ err }, 'mux: failed to fetch viewer count (non-fatal)')
    return 0
  }
}

/* ── Verify Mux webhook signature ──────────────────────
   Mux signs each delivery as `Mux-Signature: t=<unix-seconds>,v1=<hmac>`,
   where the HMAC covers `<t>.<raw body>`.

   The timestamp is part of what is signed, so it cannot be altered — but it
   was previously only fed into the HMAC and never *checked*. A signature stays
   valid for as long as the secret does, so any captured callback replays
   forever: re-sending `video.live_stream.active` or `.idle` flips a session's
   status at will. Binding the signature to a moment in time is the entire
   reason the timestamp is in the header.

   Tolerance matches the Mux SDK's own default of 300s. Rejections are logged
   at warn level rather than dropped silently, so if a legitimate retry ever
   lands outside the window it is visible and MUX_WEBHOOK_TOLERANCE_SECONDS can
   be widened, instead of a recording quietly failing to attach. */
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300

function webhookToleranceSeconds(): number {
  const raw = Number(process.env['MUX_WEBHOOK_TOLERANCE_SECONDS'])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WEBHOOK_TOLERANCE_SECONDS
}

/** Parse `t=…,v1=…`, splitting each pair on its FIRST `=` only, so a value
 *  containing `=` (base64 padding, say) is not silently truncated. */
function parseSignatureHeader(header: string): { t?: string; v1?: string } {
  const out: { t?: string; v1?: string } = {}
  for (const segment of header.split(',')) {
    const i = segment.indexOf('=')
    if (i <= 0) continue
    const key   = segment.slice(0, i).trim()
    const value = segment.slice(i + 1).trim()
    if (key === 't')  out.t  = value
    if (key === 'v1') out.v1 = value
  }
  return out
}

export function verifyWebhookSignature(
  rawBody:   Buffer | string,
  signature: string | undefined,
  nowMs:     number = Date.now(),
): boolean {
  if (!env.MUX_WEBHOOK_SECRET || !signature) return false

  const { t: ts, v1 } = parseSignatureHeader(signature)
  if (!ts || !v1) return false

  const body    = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const payload = `${ts}.${body}`

  const expected = crypto
    .createHmac('sha256', env.MUX_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')

  /* Authenticity first, so a rejection can be reported as "forged" or
     "replayed" rather than one indistinguishable failure. Constant-time. */
  let authentic: boolean
  try {
    authentic = crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false          /* v1 was not valid hex, or lengths differ */
  }
  if (!authentic) return false

  /* Freshness. Signed, so the value is trustworthy — but only meaningful if
     someone actually compares it to the clock. */
  const tsSeconds = Number(ts)
  if (!Number.isFinite(tsSeconds)) {
    logger.warn({ ts }, 'mux webhook: signature timestamp is not a number — rejecting')
    return false
  }

  const tolerance = webhookToleranceSeconds()
  const ageSeconds = Math.abs(nowMs / 1000 - tsSeconds)   /* abs: a far-future
    timestamp is as suspect as a stale one, and catches clock skew either way */
  if (ageSeconds > tolerance) {
    logger.warn(
      { ageSeconds: Math.round(ageSeconds), tolerance },
      'mux webhook: signature outside the freshness window — rejecting as a replay. ' +
      'If this is a legitimate retry, widen MUX_WEBHOOK_TOLERANCE_SECONDS.',
    )
    return false
  }

  return true
}
