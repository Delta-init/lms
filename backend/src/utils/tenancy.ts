import { Types } from 'mongoose'
import type { Request, Response, NextFunction } from 'express'

/* ─────────────────────────────────────────────────────
   Multi-academy tenancy — one implementation
   ─────────────────────────────────────────────────────
   Delta runs two independent academies (Dubai, Bangalore). Every scoped
   record carries an `organizationId`, and staff below super_admin may only
   reach their own academy's rows.

   That rule was previously hand-written in four places, and each copy grew its
   own bug — N-07, N-10 and N-11 were all the same mistake in different files.
   This module is the single implementation, so a fix lands everywhere at once.

   THREE RULES, and the ORDER matters:

     1. super_admin is never scoped. It picks an active academy via the
        X-Organization-Id header, but that is a view filter, not a permission
        boundary.

     2. A record with no academy stays reachable. These predate the split; the
        boot backfill stamps them, so this is a safety net rather than a path
        anyone should hit.

     3. A caller with no academy ON RECORD is unscoped — but a caller with NO
        RECORD AT ALL is denied. Those are different situations and conflating
        them is exactly how N-04 and N-07 happened: `findById` returns null both
        for a legacy account and for one that was deleted while its token is
        still live.

   Note the caller's academy is resolved from the DATABASE when the request
   does not already carry it. `authenticate` and `authenticateAdmin` populate
   `req.user.organizationId`; `authenticateAny` does NOT. Reading the field
   blind is what let a neighbouring academy's admin read identity documents
   (N-07).
───────────────────────────────────────────────────── */

/** The caller's account no longer exists — distinct from having no academy. */
const ACCOUNT_GONE = Symbol('account-gone')

type CallerOrg = string | null | typeof ACCOUNT_GONE

/** Per-request memo so a handler that checks twice only queries once. */
const CACHE = Symbol('caller-org')

export async function resolveCallerOrg(req: Request): Promise<CallerOrg> {
  const cached = (req as Request & { [CACHE]?: CallerOrg })[CACHE]
  if (cached !== undefined) return cached

  let result: CallerOrg
  if (req.user?.organizationId) {
    result = req.user.organizationId
  } else if (!req.user?.id || !Types.ObjectId.isValid(req.user.id)) {
    result = ACCOUNT_GONE
  } else {
    const { UserModel } = await import('@/models/schema.ts')
    const self = await UserModel.findById(req.user.id).select('organizationId').lean()
    result = !self
      ? ACCOUNT_GONE
      : ((self as { organizationId?: unknown }).organizationId?.toString() ?? null)
  }

  ;(req as Request & { [CACHE]?: CallerOrg })[CACHE] = result
  return result
}

/**
 * May this caller act on a record belonging to `recordOrg`?
 * Applies the three rules above. `recordOrg` may be an ObjectId, a string,
 * null or undefined.
 */
/**
 * True when the caller's account no longer exists — a deleted user whose access
 * token is still inside its lifetime.
 *
 * Callers that FILTER by organisation rather than compare against one need this
 * separately, because `resolveCallerOrg` returns two different falsy-looking
 * things: `null` means "exists, no academy on record" (rule 3b — unscoped, by
 * design) and ACCOUNT_GONE means "no record at all" (rule 3a — deny). Code that
 * writes `typeof callerOrg === 'string' ? callerOrg : undefined` collapses the
 * two and hands a deleted account an UNSCOPED view of the whole platform (P-18).
 */
export async function callerIsGone(req: Request): Promise<boolean> {
  return (await resolveCallerOrg(req)) === ACCOUNT_GONE
}

export async function callerMayAccess(req: Request, recordOrg: unknown): Promise<boolean> {
  if (req.user?.role === 'super_admin') return true      /* rule 1 */
  if (!recordOrg) return true                            /* rule 2 */

  const callerOrg = await resolveCallerOrg(req)
  if (callerOrg === ACCOUNT_GONE) return false           /* rule 3a */
  if (!callerOrg) return true                            /* rule 3b */

  return String(callerOrg) === String(recordOrg)
}

/* ─────────────────────────────────────────────────────
   requireSameOrgUser(param)
   ─────────────────────────────────────────────────────
   Route guard for the ~10 admin endpoints that address a USER by id —
   editing, deleting, approving enrolment, rewriting identity-document links.
   None of them compared academies, so an admin of one could act on the
   other's students purely by knowing an id (H-04).

   Answers 404 rather than 403 across an academy boundary, so the endpoint
   never confirms that an id exists elsewhere.
───────────────────────────────────────────────────── */
export function requireSameOrgUser(param: 'id' | 'userId' = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params[param] ?? '')
      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid user id' },
        }); return
      }

      const { UserModel } = await import('@/models/schema.ts')
      const target = await UserModel.findById(id).select('organizationId').lean()
      if (!target) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        }); return
      }

      if (!(await callerMayAccess(req, (target as { organizationId?: unknown }).organizationId))) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        }); return
      }

      next()
    } catch (err) { next(err) }
  }
}
