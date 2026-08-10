import rateLimit from 'express-rate-limit'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { Request } from 'express'
import { sendError } from '@/utils/response.ts'
import { logger } from '@/utils/logger.ts'

const isDev = process.env.NODE_ENV !== 'production'

/* Read a positive integer from env, falling back to a default. */
const envInt = (key: string, fallback: number): number => {
  const v = Number(process.env[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/* ─────────────────────────────────────────────────────
   Who is being limited?  (M-11)
   ─────────────────────────────────────────────────────
   Browsers reach the API as: browser → Next proxy → nginx → here. The Next
   proxy calls us server-side, so `req.ip` is the PROXY for every visitor and
   a single bucket ends up shared by the whole user base — one person
   mistyping a password can exhaust the login limit for everybody.

   The real client address cannot be relayed in the usual headers:
     • nginx rewrites `X-Real-IP` with `$remote_addr` (nginx.lms.conf:39)
     • nginx appends to `X-Forwarded-For`, and its leading entry is whatever
       the caller sent — forgeable by anyone hitting the API directly

   So the proxy relays it in a dedicated header and proves the header came
   from us with a shared secret. Anything unproven falls back to `req.ip`,
   which is exactly today's behaviour — so with PROXY_SHARED_SECRET unset
   nothing changes at all.

   Set PROXY_SHARED_SECRET to the same value in backend/.env and in both
   frontends to switch per-visitor limiting on.
───────────────────────────────────────────────────── */
const PROXY_SECRET = process.env['PROXY_SHARED_SECRET']?.trim()

if (!PROXY_SECRET && !isDev) {
  logger.warn(
    'PROXY_SHARED_SECRET is not set — rate limits key on the proxy address, so all users share one bucket. See M-11.',
  )
}

const secretMatches = (presented: unknown): boolean => {
  if (!PROXY_SECRET || typeof presented !== 'string') return false
  const a = Buffer.from(presented)
  const b = Buffer.from(PROXY_SECRET)
  if (a.length !== b.length) return false      /* timingSafeEqual throws on length mismatch */
  return timingSafeEqual(a, b)
}

/* ─── Address → bucket ──────────────────────────────
   The relayed value starts life as a request header, so the shared secret
   proves only WHO relayed it, never that the VALUE is sane. Without a strict
   parse an attacker mints a fresh bucket per request — rate limiting bypassed
   outright, and the in-memory store grows without bound.

   So: parse it as a real address or refuse it. IPv6 is bucketed by /64,
   because a single host is routinely handed a whole /64 and limiting one /128
   limits nothing. Returns null when the input is not an address. */
function ipBucket(raw: string): string | null {
  const ip  = raw.trim()
  const fam = isIP(ip)

  if (fam === 4) return ip
  if (fam !== 6) return null

  /* IPv4-mapped (::ffff:1.2.3.4) is really a v4 client — bucket it as one. */
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped?.[1] && isIP(mapped[1]) === 4) return mapped[1]

  /* Expand the :: shorthand, then keep the first four hextets. */
  const [head = '', tail = ''] = ip.split('::')
  const headParts = head ? head.split(':') : []
  const tailParts = tail ? tail.split(':') : []
  const gap       = ip.includes('::') ? Math.max(0, 8 - headParts.length - tailParts.length) : 0
  const full      = [...headParts, ...Array<string>(gap).fill('0'), ...tailParts]

  /* Strip leading zeros so 2001:0db8 and 2001:db8 land in the same bucket. */
  const prefix = full.slice(0, 4).map(h => (parseInt(h, 16) || 0).toString(16))
  return `${prefix.join(':')}::/64`
}

export function clientKey(req: Request): string {
  /* 1. An authenticated caller is the fairest and least spoofable bucket.
        Only present on limiters that run after authenticate(); the global
        limiter is mounted ahead of it and will fall through. */
  const userId = (req as Request & { user?: { id?: string } }).user?.id
  if (userId) return `u:${userId}`

  /* 2. The real browser address, relayed by our own proxy, proven by the
        shared secret AND parsed as a genuine address. A value that fails the
        parse is discarded rather than trusted — see ipBucket(). */
  if (secretMatches(req.headers['x-lms-proxy-secret'])) {
    const claimed = req.headers['x-lms-client-ip']
    if (typeof claimed === 'string') {
      const bucket = ipBucket(claimed)
      if (bucket) return `ip:${bucket}`
    }
  }

  /* 3. Whatever Express resolves under `trust proxy`. */
  return `ip:${ipBucket(req.ip ?? '') ?? 'unknown'}`
}

/* Global kill switch for load testing.
   Set DISABLE_RATE_LIMIT=true (then reload) to bypass ALL limiters, so a
   load test from a single IP isn't throttled. Remember to unset afterwards.
   Never honoured when NODE_ENV=production. */
const rateLimitDisabled = () => isDev && process.env.DISABLE_RATE_LIMIT === 'true'

if (rateLimitDisabled()) {
  logger.warn('DISABLE_RATE_LIMIT is active — ALL rate limiters are bypassed (non-production only)')
}

/* ─── Auth endpoints ─────────────────────────────────
   Production: 15 requests per 15 minutes per IP  (override: RATE_LIMIT_AUTH_MAX)
   Development: 200 / 15min so dev iteration isn't blocked
───────────────────────────────────────────────────── */
export const authRateLimit = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              envInt('RATE_LIMIT_AUTH_MAX', isDev ? 200 : 15),
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     clientKey,
  skip:             rateLimitDisabled,
  handler: (_req, res) => {
    sendError(res, 'RATE_LIMITED', 'Too many requests. Please try again in 15 minutes.', 429)
  },
})

/* ─── General API (relaxed) ─────────────────────────
   100 requests per minute per IP  (override: RATE_LIMIT_API_MAX)
───────────────────────────────────────────────────── */
export const apiRateLimit = rateLimit({
  windowMs:         60 * 1000,
  max:              envInt('RATE_LIMIT_API_MAX', 100),
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     clientKey,
  skip:             rateLimitDisabled,
  handler: (_req, res) => {
    sendError(res, 'RATE_LIMITED', 'Too many requests. Please slow down.', 429)
  },
})

/* ─── Pre-registration document upload (M-05) ───────
   POST /uploads/signup-doc has no session behind it — it cannot, because it
   runs before the account exists. That makes it the only anonymous write into
   storage in the system, so it gets its own deliberately tight bucket rather
   than sharing the auth one.

   15/hour, not 3: a full signup needs exactly three uploads, and a shared
   office or household address may hold several genuine signups in a day. The
   form also caches what it has already stored, so a retry after a rejected
   registration does not spend the budget again. That leaves ~45 MB/hour as the
   worst an abuser gets from one address, into a bucket nothing serves publicly.
   Override: RATE_LIMIT_SIGNUP_UPLOAD_MAX.
──────────────────────────────────────────────────── */
export const signupUploadRateLimit = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             envInt('RATE_LIMIT_SIGNUP_UPLOAD_MAX', isDev ? 200 : 15),
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientKey,
  skip:            rateLimitDisabled,
  handler: (_req, res) => {
    sendError(res, 'RATE_LIMITED', 'Too many document uploads. Please try again later.', 429)
  },
})

/* ─── Search endpoints (moderate) ───────────────────
   30 requests per minute per IP  (override: RATE_LIMIT_SEARCH_MAX)
───────────────────────────────────────────────────── */
export const searchRateLimit = rateLimit({
  windowMs:        60 * 1000,
  max:             envInt('RATE_LIMIT_SEARCH_MAX', 30),
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    clientKey,
  skip:            rateLimitDisabled,
  handler: (_req, res) => {
    sendError(res, 'RATE_LIMITED', 'Search rate limit exceeded.', 429)
  },
})
