/* ─────────────────────────────────────────────────────
   Join tickets  (LMS → CLT Connect)
   ─────────────────────────────────────────────────────
   A ticket is a 90-second, single-use, Ed25519-signed statement of WHO is
   entering a room and WHAT they may do there. It authorises *entering*; the
   LiveKit token CLT mints in exchange sustains the session for hours.

   Why so short: the ticket travels through the browser, so it will end up in
   history, logs and screenshots. Ninety seconds is long enough to click
   through and far too short to pass around. `jti` makes even that window
   single-use — CLT records it in Redis and refuses a second presentation.

   Why the LMS decides `grants`: entitlement lives here, with the bookings and
   enrolment records. CLT re-deriving them would mean two sources of truth for
   who may speak in a classroom, and the meeting platform cannot see a booking.
   It maps our grants onto its existing LiveKit token helpers and adds nothing.
───────────────────────────────────────────────────── */
import { SignJWT } from 'jose'
import { activeSigningKey, TICKET_ALG, TICKET_ISSUER, TICKET_AUD } from '@/utils/integrationKeys.ts'

export const TICKET_TTL_SECONDS = Number(process.env['INTEGRATION_TICKET_TTL_SEC'] ?? 90)

export type TicketRole = 'student' | 'instructor' | 'admin'

export interface TicketGrants {
  /** May publish camera/mic. Students in broadcast-style classes get false. */
  canPublish:  boolean
  /** LiveKit room admin — mute/remove others. Instructors only. */
  roomAdmin:   boolean
  /** Skip the lobby. Denied for a late student so CLT's grace policy applies. */
  bypassLobby: boolean
  /** Invisible in the participant list. Admin observers only — an instructor
      or student is never hidden, because a classroom where someone might be
      silently present is a different product. */
  hidden?:     boolean
  /** May this person reveal themselves from INSIDE the room?
   *
   *  The LMS still decides — CLT only offers the control because this says it
   *  may. Without it, an in-room toggle would mean the meeting platform
   *  inventing an authority the whole design says it does not have.
   *
   *  Granted to admin observers only. An instructor is never hidden and a
   *  student never unhides, so for them the question does not arise. */
  mayUnhide?:  boolean
}

export interface TicketClaims {
  userId:      string
  name:        string
  email:       string
  role:        TicketRole
  liveClassId: string
  roomName:    string
  orgSlug?:    string
  /** For the participant tile when the camera is off. Travels in the ticket
      because CLT has no way to look an LMS user up. */
  avatarUrl?:  string
  grants:      TicketGrants
}

export class IntegrationDisabledError extends Error {
  constructor() { super('CLT integration is not configured on this deployment') }
}

/** Room names are derived, never client-supplied — see mintTicket. */
export function roomNameFor(liveClassId: string): string {
  return `lms-${liveClassId}`
}

export interface MintedTicket {
  ticket:    string
  expiresIn: number
  roomName:  string
  jti:       string
}

/**
 * Mint a join ticket. Throws IntegrationDisabledError when no signing key is
 * configured, so callers surface a clear 503 rather than a signing crash.
 */
export async function mintTicket(claims: TicketClaims): Promise<MintedTicket> {
  const key = await activeSigningKey()
  if (!key) throw new IntegrationDisabledError()

  /* Random rather than sequential: a jti is the replay key, and a guessable
     one would let an attacker pre-burn a ticket they never saw. */
  const jti = crypto.randomUUID()

  const ticket = await new SignJWT({
    name:        claims.name,
    email:       claims.email,
    role:        claims.role,
    liveClassId: claims.liveClassId,
    /* Derived from liveClassId by roomNameFor(), never taken from a request:
       a caller-chosen room name would let a student with any valid booking
       mint themselves into somebody else's classroom. */
    roomName:    claims.roomName,
    ...(claims.orgSlug ? { orgSlug: claims.orgSlug } : {}),
    ...(claims.avatarUrl ? { avatarUrl: claims.avatarUrl } : {}),
    grants:      claims.grants,
  })
    .setProtectedHeader({ alg: TICKET_ALG, kid: key.kid })
    .setSubject(claims.userId)
    .setJti(jti)
    .setIssuedAt()
    .setIssuer(TICKET_ISSUER)
    .setAudience(TICKET_AUD)
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(key.private)

  return { ticket, expiresIn: TICKET_TTL_SECONDS, roomName: claims.roomName, jti }
}
