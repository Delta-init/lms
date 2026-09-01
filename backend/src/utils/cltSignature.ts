/* Verifying a call that claims to come from CLT Connect.
 *
 * One implementation, two callers: the webhook endpoint (which signs the raw
 * request body) and the handoff exchange (which signs the code being claimed).
 * They were going to be two copies of the same forty lines, and two copies of
 * a signature check is how one of them quietly loses its freshness window.
 *
 * The scheme is CLT's `_sign` in services/lms_events.py, byte for byte:
 *
 *     HMAC-SHA256(secret, "<timestamp>.<nonce>." + payload)
 *
 * What the PAYLOAD is differs per endpoint, and that is the point. A webhook
 * signs its body. A GET has no body, so signing "nothing" would leave the
 * signature covering only the clock — and a captured header set could then be
 * replayed against a DIFFERENT handoff code for the next five minutes. So the
 * handoff signs the code itself, and a signature is good for one code only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SignatureFailure =
  | 'MISSING_SIGNATURE'
  | 'STALE_TIMESTAMP'
  | 'BAD_SIGNATURE'

/** How far a request's clock may drift before it is refused. */
export const CLT_MAX_SKEW_MS = 5 * 60_000

export interface SignatureHeaders {
  timestamp?: string | string[] | undefined
  nonce?:     string | string[] | undefined
  signature?: string | string[] | undefined
}

function one(v: string | string[] | undefined): string {
  return String(Array.isArray(v) ? v[0] ?? '' : v ?? '')
}

/**
 * Returns null when the call is genuine, or the reason it is not.
 *
 * Deliberately returns a reason rather than throwing: the two callers answer
 * with different shapes, and an exception would tempt one of them into a
 * catch-all that swallows a real forgery as a 500.
 */
export function verifyCltSignature(
  headers: SignatureHeaders,
  payload: Buffer | string,
  secret: string,
  now: number = Date.now(),
): SignatureFailure | null {
  const timestamp = one(headers.timestamp)
  const nonce     = one(headers.nonce)
  const signature = one(headers.signature)
  if (!timestamp || !nonce || !signature) return 'MISSING_SIGNATURE'

  /* Freshness first — the cheap check, and the one that stops a captured
     request being replayed tomorrow with a still-valid signature. */
  const skewMs = Math.abs(now - Number(timestamp))
  if (!Number.isFinite(skewMs) || skewMs > CLT_MAX_SKEW_MS) return 'STALE_TIMESTAMP'

  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.${nonce}.`), body]))
    .digest('hex')

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  /* Length is compared first because timingSafeEqual throws on a mismatch —
     and a thrown error would read as a 500 rather than a rejection. */
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'BAD_SIGNATURE'
  return null
}
