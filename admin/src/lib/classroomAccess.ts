/* Which roles may reach a classroom — live, or its recording afterwards.
 *
 * A COSMETIC mirror of ADMIN_OBSERVER_ROLES in
 * backend/src/services/liveClassJoin.service.ts. The server is the authority
 * and enforces this on every request; this copy exists only so the UI does not
 * offer a door that will answer 403.
 *
 * Deliberately excludes `support`: support staff handle tickets in the LMS,
 * while their meeting-side duties live in the meeting platform under its own
 * customer_service tier. A role that may not enter a classroom is not shown
 * the tape of one either.
 *
 * If these two lists ever disagree the server wins, and the symptom is a menu
 * item that 403s — annoying, never unsafe.
 */
export const CLASSROOM_ROLES = new Set(['super_admin', 'admin', 'sub_admin'])

export function mayReachClassroom(role: string | undefined): boolean {
  return !!role && CLASSROOM_ROLES.has(role)
}
