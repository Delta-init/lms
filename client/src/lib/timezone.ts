/**
 * timezone.ts — Show every date/time in the STUDENT'S OWN timezone.
 *
 * The backend sends timestamps in UTC and the browser formats them in the
 * device timezone by default — which is exactly what we want for students: a
 * class stored as 12:00 UTC reads "4:00 PM" to a student in Dubai and
 * "5:30 PM" to a student in Bangalore, and each can walk into the session at
 * the right local moment.
 *
 * Historical note: this module used to monkey-patch all formatters to pin the
 * app to Asia/Dubai. That was removed on purpose — students of BOTH academies
 * now see their own wall clock (device timezone beats "country of residence":
 * it follows travellers automatically and needs no profile data). The admin
 * panel keeps an academy-pinned clock in its own copy of this module; do not
 * re-introduce the patch here.
 *
 * APP_TIMEZONE resolves to the viewer's IANA zone (e.g. "Asia/Kolkata") and is
 * used where code needs the zone NAME — day-bucketing keys and "times shown
 * in ..." labels. On the server (SSR) it resolves to the server's zone; every
 * date the app renders sits behind client-side data loading, so the value is
 * only ever user-visible in the browser.
 */
export const APP_TIMEZONE: string =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
