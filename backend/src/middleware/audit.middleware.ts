import type { Request, Response, NextFunction } from 'express'
import { AuditLogRepository } from '@/repositories/auditlog.repository.ts'
import { logger } from '@/utils/logger.ts'
import type { AuditAction } from '@/models/schema.ts'

const auditRepo = new AuditLogRepository()

/**
 * Returns an Express middleware that writes an audit log entry AFTER
 * the response is sent (fire-and-forget, never blocks the request).
 *
 * Usage:
 *   router.delete('/:id', authenticate, requireAdmin, audit('course.delete', 'Course', r => r.params['id']), handler)
 */
export function audit(
  action:       AuditAction,
  entity:       string,
  getEntityId?: (req: Request) => string | undefined,
  getMeta?:     (req: Request) => Record<string, unknown>,
) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      /* Only log on successful mutating responses (2xx) */
      if (res.statusCode < 200 || res.statusCode >= 300) return
      const user = _req.user
      if (!user) return

      /* Stamp the acting staff member's academy so the trail can be scoped
         (H-12). Resolved through the shared helper because `req.user` does not
         always carry it — authenticateAny never populates the field. Written
         inside the fire-and-forget block, so a lookup here never delays the
         response. super_admin has no academy and its entries stay global. */
      void (async () => {
        const { resolveCallerOrg } = await import('@/utils/tenancy.ts')
        const org = user.role === 'super_admin' ? null : await resolveCallerOrg(_req)
        /* Record the REAL operator (M-04). Under impersonation, req.user is
           the borrowed account — correct for authorisation, wrong for a trail
           whose whole job is answering "who did this". Before the actor claim
           existed there was nothing to attribute it to, so an admin acting
           through impersonation was indistinguishable from the user acting
           themselves. The impersonated account is kept alongside, because
           which account the change was made IN still matters. */
        const impersonating = !!user.impersonatorId

        return auditRepo.create({
          organizationId: typeof org === 'string' ? org : undefined,
          actorId:    impersonating ? user.impersonatorId!    : user.id,
          actorEmail: impersonating ? user.impersonatorEmail! : user.email,
          actorRole:  user.role,
          action,
          entity,
          entityId:   getEntityId?.(_req),
          meta: {
            ...(getMeta?.(_req) ?? {}),
            ...(impersonating && {
              impersonating:   true,
              impersonatedId:    user.id,
              impersonatedEmail: user.email,
              impersonationId:   user.impersonationId,
            }),
          },
          ip:         (_req.ip ?? _req.socket?.remoteAddress) || undefined,
          userAgent:  _req.headers['user-agent'] || undefined,
        })
      })().catch(err => logger.warn({ err }, 'audit log write failed'))
    })
    next()
  }
}
