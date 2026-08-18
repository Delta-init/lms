/**
 * timezone.ts — Display every date/time in the ACTIVE ACADEMY's timezone.
 *
 * The backend sends timestamps in UTC. By default the browser renders them in
 * the viewer's *device* timezone, so the dashboard would show times in whatever
 * zone the operator's machine is set to. This module pins all date/time
 * *formatting* to the academy being administered:
 *
 *   Dubai academy     → Asia/Dubai   (UTC+4)
 *   Bangalore academy → Asia/Kolkata (UTC+5:30)
 *
 * Scoped admins/instructors get their own academy's zone; a super admin follows
 * the org switcher in the topbar ("All Orgs" falls back to Dubai, the HQ zone).
 * `<TimezoneScope>` in providers.tsx resolves the zone and calls
 * `setActiveTimeZone` — this module only holds the mechanism.
 *
 * It works by wrapping the locale-aware formatters to inject the active zone
 * whenever the caller didn't pass an explicit `timeZone`. This covers every
 * existing `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` /
 * `Intl.DateTimeFormat` call across the app — and any added later — from one
 * place.
 *
 * Note: `Number.prototype.toLocaleString` (used for counts) is a different
 * method and is intentionally left untouched.
 *
 * Installed once from `providers.tsx`, which runs during both server render and
 * in the browser. SSR always formats in the default zone (org context resolves
 * client-side only, after data loads), so server and client first paint match.
 */
export const DEFAULT_TIMEZONE = 'Asia/Dubai'

/* One academy → one timezone. Keyed by Organization.slug (see backend
   Organization model — slugs are a closed enum, so new academies already
   require a code change and belong in this map too). */
export const ORG_TIMEZONES: Record<string, string> = {
  dubai:     'Asia/Dubai',
  bangalore: 'Asia/Kolkata',
}

export function orgTimeZone(slug?: string | null): string {
  return (slug && ORG_TIMEZONES[slug]) || DEFAULT_TIMEZONE
}

let activeTimeZone = DEFAULT_TIMEZONE

export function setActiveTimeZone(tz: string | undefined | null): void {
  activeTimeZone = tz || DEFAULT_TIMEZONE
}

export function getActiveTimeZone(): string {
  return activeTimeZone
}

let installed = false

const withTz = (options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions =>
  options?.timeZone ? options : { ...options, timeZone: activeTimeZone }

export function installAppTimezone(): void {
  if (installed) return
  installed = true

  /* Date.prototype.toLocale* */
  const dp = Date.prototype
  const origStr = dp.toLocaleString
  const origDate = dp.toLocaleDateString
  const origTime = dp.toLocaleTimeString

  dp.toLocaleString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return origStr.call(this, locales, withTz(options))
  }
  dp.toLocaleDateString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return origDate.call(this, locales, withTz(options))
  }
  dp.toLocaleTimeString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return origTime.call(this, locales, withTz(options))
  }

  /* Intl.DateTimeFormat — used directly by some components.
   * Typed as `any` so we can copy over `prototype`/statics (which are read-only
   * on the constructor type) before installing the patched version. */
  const OrigDTF = Intl.DateTimeFormat
  const PatchedDTF: any = function (
    this: unknown,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new (OrigDTF as unknown as { new (l?: unknown, o?: unknown): Intl.DateTimeFormat })(
      locales,
      withTz(options),
    )
  }

  PatchedDTF.prototype = OrigDTF.prototype
  PatchedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf.bind(OrigDTF)
  Intl.DateTimeFormat = PatchedDTF as typeof Intl.DateTimeFormat
}

// Install immediately on import (runs on both the server and the client).
installAppTimezone()

/* ─────────────────────────────────────────────────────────
   <input type="datetime-local"> helpers — keep the picker on the academy zone.

   A datetime-local value is a naive "YYYY-MM-DDTHH:mm" wall-clock string with
   no timezone. By default `new Date(value)` parses it in the *device* timezone,
   so an admin whose laptop is on IST entering "8:00 PM" for a Dubai class would
   store 8 PM IST. These helpers instead treat the picker value as wall-clock in
   the ACTIVE academy zone — a Bangalore admin schedules in IST, a Dubai admin
   in GST, regardless of the device.
───────────────────────────────────────────────────────── */

/** Offset (active-zone wall time − UTC), in ms, for the given instant. */
function tzOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: activeTimeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const m: Record<string, string> = {}
  for (const p of parts) m[p.type] = p.value
  const hour = m.hour === '24' ? '00' : m.hour
  const asIfUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +hour, +m.minute, +m.second)
  return asIfUTC - date.getTime()
}

/** Picker value (academy wall-clock "YYYY-MM-DDTHH:mm") → UTC ISO string for the API. */
export function datetimeLocalToISO(wall: string): string {
  if (!wall) return ''
  const naiveUTC = new Date(`${wall}:00.000Z`).getTime()  // parse the digits as if UTC
  const offset   = tzOffsetMs(new Date(naiveUTC))         // Dubai +4h / Kolkata +5:30 (neither has DST)
  return new Date(naiveUTC - offset).toISOString()
}

/** Stored UTC ISO → picker value showing the academy wall-clock. */
export function isoToDatetimeLocal(iso: string): string {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: activeTimeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}
