import { DeviceModel, type IDevice } from '@/models/schema.ts'

/* ─────────────────────────────────────────────────────
   Device whitelist logic (student two-device limit)
   ─────────────────────────────────────────────────────
   The first browser a student signs in on is auto-approved as their main
   device; a second is a pending request an admin approves; a third is refused
   until an admin frees a slot. Enforced by auth.service on login and refresh.
   Mirrors academy-api/src/auth/devices.ts for the AI-academy side.
───────────────────────────────────────────────────── */

/** How many devices a student may have approved at once. */
export const MAX_APPROVED_DEVICES = 2

export type DeviceOutcome =
  | { ok: true;  device: IDevice }
  | { ok: false; reason: 'pending' }
  | { ok: false; reason: 'limit' }
  | { ok: false; reason: 'revoked' }

/** A short label from the user agent — enough for an admin to tell two devices
 *  apart in the approval list, without a UA-parsing dependency. */
export function labelFromUserAgent(ua?: string): string {
  if (!ua) return 'Unknown device'
  const browser =
    /Edg\//.test(ua)            ? 'Edge'    :
    /OPR\/|Opera/.test(ua)      ? 'Opera'   :
    /Chrome\//.test(ua)         ? 'Chrome'  :
    /Firefox\//.test(ua)        ? 'Firefox' :
    /Safari\//.test(ua)         ? 'Safari'  : 'Browser'
  const os =
    /iPhone|iPad|iPod/.test(ua)   ? 'iOS'     :
    /Android/.test(ua)            ? 'Android' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS'   :
    /Windows/.test(ua)            ? 'Windows' :
    /Linux/.test(ua)              ? 'Linux'   : ''
  return os ? `${browser} on ${os}` : browser
}

/**
 * Resolves a browser against the two-device whitelist at sign-in, creating the
 * device row as a side effect:
 *   - known + approved  → signs in.
 *   - known + pending   → still waiting on an admin.
 *   - known + revoked   → refused.
 *   - new, 0 approved   → auto-approved as the main device, signs in.
 *   - new, 1 approved   → pending, refused until an admin approves.
 *   - new, ≥2 approved  → recorded as pending but reported as "limit", so an
 *                         admin sees the request yet must free a slot first.
 */
export async function resolveDeviceForLogin(
  userId: string,
  deviceId: string,
  info: { userAgent?: string; ip?: string },
): Promise<DeviceOutcome> {
  const now = new Date()

  const existing = await DeviceModel.findOne({ userId, deviceId })
  if (existing) {
    if (existing.status === 'revoked') return { ok: false, reason: 'revoked' }
    existing.lastSeenAt = now
    if (info.userAgent) existing.userAgent = info.userAgent.slice(0, 500)
    if (info.ip) existing.ip = info.ip
    await existing.save()
    if (existing.status === 'approved') return { ok: true, device: existing }
    return { ok: false, reason: 'pending' }
  }

  const approvedCount = await DeviceModel.countDocuments({ userId, status: 'approved' })
  const isFirst = approvedCount === 0

  try {
    const device = await DeviceModel.create({
      userId,
      deviceId,
      status:     isFirst ? 'approved' : 'pending',
      isMain:     isFirst,
      label:      labelFromUserAgent(info.userAgent),
      userAgent:  info.userAgent?.slice(0, 500),
      ip:         info.ip,
      approvedAt: isFirst ? now : undefined,
      lastSeenAt: now,
    })
    if (isFirst) return { ok: true, device }
  } catch (err) {
    // Lost a race with a concurrent request for the same browser — decide on
    // the row that won rather than double-inserting.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const row = await DeviceModel.findOne({ userId, deviceId })
      if (row?.status === 'approved') return { ok: true, device: row }
      if (row?.status === 'revoked') return { ok: false, reason: 'revoked' }
      return { ok: false, reason: 'pending' }
    }
    throw err
  }

  // A brand-new device beyond the first: pending if a slot is open, otherwise a
  // hard limit (the row still exists for the admin to see).
  return approvedCount >= MAX_APPROVED_DEVICES
    ? { ok: false, reason: 'limit' }
    : { ok: false, reason: 'pending' }
}

/** Read-only check used on refresh: the session stays alive only while its
 *  browser is still an approved device. A revoked (or never-approved) device
 *  fails here and the caller ends the session. */
export async function isDeviceApproved(userId: string, deviceId: string): Promise<boolean> {
  if (!deviceId) return false
  const device = await DeviceModel.findOneAndUpdate(
    { userId, deviceId, status: 'approved' },
    { $set: { lastSeenAt: new Date() } },
  )
  return device !== null
}
