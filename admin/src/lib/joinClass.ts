'use client'
import { api } from '@/lib/axios'

/* Handing a class over to the meeting platform.
 *
 * One place, so every Join button behaves the same. On the admin side the
 * studio and the monitor page both lead here, and a copy each would drift the
 * first time an error case changed.
 *
 * `window.location.assign`, not router.push: the destination is a different
 * origin, and Next's router cannot navigate there. Same tab on purpose — a new
 * tab is blocked by popup blockers when the click is even slightly indirect,
 * and on mobile it strands the student in a second tab with no way back.
 *
 * The path is the ADMIN one. Both portals expose a handoff and they are not
 * interchangeable: each is guarded by its own session cookie, so this app must
 * ask the admin router or it would be answered as whoever happens to be signed
 * in on the student side of the same browser.
 */
export interface HandoffResponse {
  url:        string
  expiresIn:  number
  ttlSeconds: number
}

export async function redirectToClass(liveClassId: string, opts: { visible?: boolean } = {}): Promise<never | void> {
  const res = await api.post<{ success: true; data: HandoffResponse }>(
    `/admin/live-classes/${liveClassId}/handoff`,
    opts,
  )
  const url = res.data.data.url
  if (!url) throw new Error('The meeting platform address is not configured.')
  window.location.assign(url)
}

/** The message to show when a handoff is refused, preferring the server's. */
export function handoffError(err: unknown): string {
  const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return e?.response?.data?.error?.message
    ?? e?.message
    ?? 'Could not open this class. Please try again.'
}
