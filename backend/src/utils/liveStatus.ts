/**
 * liveStatus.ts — effective live-class status based on the clock.
 *
 * A scheduled session is shown/counted as **Live Now** during the window:
 *   from 15 min BEFORE its start
 *   to   the session END time  (scheduledStart + durationMins)
 *
 * Timeline for a 'scheduled' session relative to now:
 *   now < start - 15m              → 'scheduled' (upcoming)
 *   start - 15m ≤ now < start + durationMins → 'live'  (live window)
 *   now ≥ start + durationMins     → 'ended'
 *
 * Sessions the backend has explicitly marked ('live' streaming, 'ended', 'cancelled')
 * keep that status — a real live stream is always live regardless of the clock.
 *
 * This is display/counting only; the stored DB status is never changed, so internal
 * (Mux) sessions can still be started late or rescheduled.
 */
export const LIVE_LEAD_MS = 15 * 60_000  // session becomes "live" 15 min before start

/* ── When a student may still take a seat ────────────────────────────────
   Booking closes a fixed period BEFORE the class starts: a class at 11:00
   stops accepting bookings at 10:00.

   The point is the hour itself. Somebody booking at 10:58 for an 11:00 class
   is a seat the instructor cannot prepare for, a join link the mail queue may
   not deliver in time, and a head-count that was already wrong when it was
   taken. An hour is enough to act on the final list.

   Note what this REPLACES. Booking did not previously close at the start time
   — it closed at start minus 15 minutes, because resolveLiveStatus() calls a
   class "live" from then and the route refuses a live class. So this widens an
   existing 15-minute window to 60, rather than introducing the first one.

   Offline classes are not governed by this: they already close at midnight the
   day before, which is stricter, and that rule lives in the client's slot
   resolver. Nothing here loosens it.

   Overridable so an academy running short-notice sessions can shorten it
   without a deploy. Parsed once — env is fixed at boot. */
const CUTOFF_MINUTES = (() => {
  const raw = Number(process.env['BOOKING_CUTOFF_MINUTES'])
  return Number.isFinite(raw) && raw >= 0 ? raw : 60
})()

export const BOOKING_CUTOFF_MS = CUTOFF_MINUTES * 60_000

/** The instant after which no new booking is accepted. */
export function bookingClosesAt(scheduledStart: Date | string): Date {
  return new Date(new Date(scheduledStart).getTime() - BOOKING_CUTOFF_MS)
}

/** True while a seat may still be taken. `now` is injectable so the rule can
 *  be tested at an exact instant rather than against the wall clock. */
export function isBookingOpen(scheduledStart: Date | string, now: number = Date.now()): boolean {
  return now < bookingClosesAt(scheduledStart).getTime()
}

/** Minutes until booking closes — negative once it has. For messages. */
export function minutesUntilBookingCloses(
  scheduledStart: Date | string,
  now: number = Date.now(),
): number {
  return Math.round((bookingClosesAt(scheduledStart).getTime() - now) / 60_000)
}

export function resolveLiveStatus(
  rawStatus: string,
  scheduledStart: Date | string,
  durationMins: number,
  now: number = Date.now(),
): string {
  if (rawStatus !== 'scheduled') return rawStatus   // live / ended / cancelled stay as-is
  const start = new Date(scheduledStart).getTime()
  const end   = start + durationMins * 60_000       // class end time
  if (now >= end) return 'ended'
  if (now >= start - LIVE_LEAD_MS) return 'live'
  return 'scheduled'
}
