import type { Response } from 'express'
import { env } from '@/config/env.ts'
import type { TokenPair } from '@/types/index.ts'

/* ─────────────────────────────────────────────────────
   Auth cookie helpers
   ─────────────────────────────────────────────────────
   Access token  → `lms_at` cookie, ~15m, Path=/
   Refresh token → `lms_rt` cookie, ~30d, Path=/api/v1/auth
   Both httpOnly + SameSite=Lax. Secure flag only in
   production so dev over http://localhost still works.
───────────────────────────────────────────────────── */

export const ACCESS_COOKIE  = 'lms_at'
export const REFRESH_COOKIE = 'lms_rt'

export const ADMIN_ACCESS_COOKIE  = 'lms_admin_at'
export const ADMIN_REFRESH_COOKIE = 'lms_admin_rt'

const REFRESH_PATH       = '/api/v1/auth'
const ADMIN_REFRESH_PATH = '/api/v1/admin/auth'

const isProd = () => env.NODE_ENV === 'production'

/* ── Cookie scope (M-21) ───────────────────────────────────────────────
   These used to be pinned to `.deltainstitutions.com` in production, which
   made both session cookies readable by EVERY subdomain — a foothold on any
   unrelated sibling host (a marketing page, a status page, a staging box)
   yielded a live admin session. The shared scope was never needed: both
   frontends proxy /api/v1/* from their own origin (see each next.config.ts
   and the [...path] route handlers), so the browser only ever exchanges these
   cookies with the host it is already on.

   Default is now HOST-ONLY — no Domain attribute, so the cookie belongs to
   exactly the host that set it. COOKIE_DOMAIN is the escape hatch: set it to
   restore a shared scope without a code change, e.g. if the apps are ever
   split across hosts that must share one session.

   Nothing about this signs anyone out — see evictLegacyCookie() below. */
const cookieDomain = () => {
  const configured = (process.env['COOKIE_DOMAIN'] ?? '').trim()
  return configured === '' ? undefined : configured
}

/* The scope cookies were issued under BEFORE the change above. A browser that
   still holds one is the problem: the old and new cookies share a name, so the
   Cookie header carries both and the server reads whichever the browser lists
   first — the older one. For the refresh cookie that is actively harmful: the
   stale copy is a token that has already been rotated, and presenting it trips
   reuse detection, which invalidates every session the account has.

   So every response that sets a cookie also deletes the legacy-scoped twin.
   Deletion is keyed on (name, domain, path), and the replacement carries a
   different domain, so this removes the old cookie without touching the new
   one. The result is a scope change with zero forced sign-outs: the first
   login or token refresh after deploy quietly swaps each user over.

   Defaults to the value that was hardcoded here, which is exactly what is
   sitting in production browsers today. Set LEGACY_COOKIE_DOMAIN='' to skip. */
const legacyCookieDomain = () => {
  const configured = process.env['LEGACY_COOKIE_DOMAIN']
  const value = (configured ?? (isProd() ? '.deltainstitutions.com' : '')).trim()
  /* Never evict what we are currently setting — that would delete the live
     cookie in the same response that issued it. */
  return value === '' || value === cookieDomain() ? undefined : value
}

function evictLegacyCookie(res: Response, name: string, path: string): void {
  const domain = legacyCookieDomain()
  if (!domain) return
  res.clearCookie(name, { path, domain })
}

function parseDurationMs(duration: string): number {
  const unit  = duration.slice(-1)
  const value = parseInt(duration.slice(0, -1), 10)
  /* Guard the number too: "bogus" ends in 's' and would otherwise return NaN,
     which Express turns into a session cookie with no expiry. */
  if (!Number.isFinite(value) || value <= 0) return 900_000   // fallback: 15m
  switch (unit) {
    case 's': return value * 1_000
    case 'm': return value * 60_000
    case 'h': return value * 3_600_000
    case 'd': return value * 86_400_000
    default:  return 900_000
  }
}

export function setAuthCookies(res: Response, tokens: TokenPair): void {
  res.cookie(ACCESS_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     '/',
    maxAge:   parseDurationMs(env.JWT_ACCESS_EXPIRES_IN),
  })
  res.cookie(REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     REFRESH_PATH,
    maxAge:   parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
  })
  evictLegacyCookie(res, ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, REFRESH_COOKIE, REFRESH_PATH)
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE,  { path: '/',          domain: cookieDomain() })
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH, domain: cookieDomain() })
  /* Logout must clear the legacy-scoped pair too. Missing it would leave a
     still-valid apex cookie in the jar, so "sign out" would not sign out. */
  evictLegacyCookie(res, ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, REFRESH_COOKIE, REFRESH_PATH)
}

/* ── Admin-portal cookies (lms_admin_at / lms_admin_rt) ─────────────────
   Completely separate from client cookies so both portals can maintain
   independent sessions on the same browser simultaneously.
──────────────────────────────────────────────────────────────────────── */
export function setAdminAuthCookies(res: Response, tokens: TokenPair): void {
  res.cookie(ADMIN_ACCESS_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     '/',
    maxAge:   parseDurationMs(env.JWT_ACCESS_EXPIRES_IN),
  })
  res.cookie(ADMIN_REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     ADMIN_REFRESH_PATH,
    maxAge:   parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
  })
  evictLegacyCookie(res, ADMIN_ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_PATH)
}

export function clearAdminAuthCookies(res: Response): void {
  res.clearCookie(ADMIN_ACCESS_COOKIE,  { path: '/',               domain: cookieDomain() })
  res.clearCookie(ADMIN_REFRESH_COOKIE, { path: ADMIN_REFRESH_PATH, domain: cookieDomain() })
  evictLegacyCookie(res, ADMIN_ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_PATH)
}
