/**
 * Pick the visitor's real address to relay to the backend (M-11).
 *
 * The API proxy calls the backend server-to-server, so without this every
 * visitor looks like this server and they all share one rate-limit bucket.
 *
 * Header precedence matters and is the whole point of this file:
 *   • X-Real-IP  — our nginx sets it from $remote_addr, OVERWRITING whatever
 *                  the caller sent. Trustworthy, so it wins.
 *   • X-Forwarded-For — nginx APPENDS to it ($proxy_add_x_forwarded_for), so
 *                  the LAST entry is what the nearest proxy actually observed.
 *                  The FIRST entry is whatever the browser sent and must never
 *                  be used — that is a rate-limit bypass.
 *
 * The backend re-validates the result as a genuine IP regardless, so a bad
 * value degrades to the shared bucket rather than becoming a forged one.
 */
export function pickClientIp(headers: Headers): string | undefined {
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const xff = headers.get('x-forwarded-for')
  if (!xff) return undefined

  const entries = xff.split(',').map(s => s.trim()).filter(Boolean)
  return entries[entries.length - 1]
}
