/* Accents and seat defaults for the session-type pickers.
 *
 * Shared because the same two buttons appear in more than one create form, and
 * a colour that means "in-app" on one screen and "external" on another is worse
 * than no colour at all. Values are "r,g,b" strings rather than hex so a single
 * constant can drive the idle, hover and selected tints of one pill.
 *
 * Green marks what runs inside our own platform. It used to sit on Google Meet
 * — the one option that does not — so Google Meet moved to amber.
 */
export const IN_APP_RGB    = '74,222,128'    // light green — In-App Stream
export const MEET_RGB      = '251,191,36'    // amber       — Google Meet, external
export const ROOM_RGB      = '167,139,250'   // violet      — Interactive room
export const BROADCAST_RGB = '0,87,184'      // brand blue  — Broadcast

/* Mirrors LIVEKIT_MAX_PARTICIPANTS in the LMS backend AND room.max_participants
   in infra/livekit.prod.yaml. All three must agree: the server refuses a larger
   number anyway, but the form should say so before submit rather than after. */
export const LIVEKIT_MAX_SEATS = 30

/* What an uncapped session (broadcast, or Google Meet) starts at. Sits next to
   LIVEKIT_MAX_SEATS so the two seat defaults are read together. */
export const OPEN_SEATS_DEFAULT = 500
