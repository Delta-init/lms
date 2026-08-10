import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticateAny, optionalAuthenticate, requireRole } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { sendSuccess, parsePagination, buildPaginationMeta } from '@/utils/response.ts'
import { LearningPathService } from '@/services/learningpath.service.ts'

const router = Router()
const svc    = new LearningPathService()

const listQuerySchema = z.object({
  page:       z.coerce.number().int().min(1).optional(),
  per_page:   z.coerce.number().int().min(1).max(100).optional(),
  categoryId: z.string().optional(),
})

const courseItemSchema = z.object({
  courseId:       z.string(),
  order:          z.number().int().min(1),
  isPrerequisite: z.boolean().optional(),
})

const upsertSchema = z.object({
  title:        z.string().min(3).max(255),
  description:  z.string().max(5000).optional(),
  thumbnailUrl: z.string().url().max(2048).optional(),
  categoryId:   z.string().optional(),
  status:       z.enum(['draft', 'published']).optional(),
  courses:      z.array(courseItemSchema).optional(),
})

const updateSchema = upsertSchema.partial()

/* ── Public routes ──────────────────────────────────── */

/* GET /learning-paths
   optionalAuthenticate so a signed-in visitor sees their own academy's paths
   and an anonymous one sees the full public catalogue — the same shape
   GET /courses uses (course.controller.ts passes req.user?.organizationId
   into listPublished). Paths are now academy-stamped (P-22). */
router.get(
  '/',
  optionalAuthenticate,
  validate(listQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const result = await svc.listPublished({
        page,
        per_page,
        categoryId: req.query['categoryId'] as string | undefined,
        organizationId: req.user?.organizationId,
      })
      sendSuccess(res, result)
    } catch (err) {
      next(err)
    }
  },
)

/* The four staff routes below use authenticateAny, not authenticate.
 * These are admin-panel screens mounted on a client-facing router, and
 * authenticate() reads only the CLIENT cookie (lms_at) — the admin panel
 * holds lms_admin_at, so every one of them answered 401 and the Learning
 * Paths section could not load, create, edit or delete anything. The axios
 * interceptor refreshed the token and got 401 again, so it looked like a
 * session problem rather than a wiring one.
 *
 * authenticateAny accepts either portal cookie and is what /uploads and
 * /documents already use for the same reason. Nothing is widened:
 * requireRole() below still restricts these to staff, and P-06 has
 * authenticateAny populating organizationId, so P-22 academy scoping is
 * unaffected. */
/* GET /learning-paths/admin/list  (must come BEFORE /:slug) */
router.get(
  '/admin/list',
  authenticateAny,
  requireRole('super_admin', 'admin', 'instructor'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const result = await svc.adminList({ page, per_page, organizationId: req.user?.organizationId })
      sendSuccess(res, result)
    } catch (err) {
      next(err)
    }
  },
)

/* GET /learning-paths/:slug */
router.get(
  '/:slug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = await svc.getBySlug(String(req.params['slug'] ?? ''))
      sendSuccess(res, { path })
    } catch (err) {
      next(err)
    }
  },
)

/* ── Authenticated write routes ─────────────────────── */

/* POST /learning-paths */
router.post(
  '/',
  authenticateAny,
  requireRole('super_admin', 'admin', 'instructor'),
  validate(upsertSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = await svc.adminCreate(req.user!.id, req.body, req.user!.organizationId)
      sendSuccess(res, { path }, 'Learning path created', 201)
    } catch (err) {
      next(err)
    }
  },
)

/* PATCH /learning-paths/:id */
router.patch(
  '/:id',
  authenticateAny,
  requireRole('super_admin', 'admin', 'instructor'),
  validate(updateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = await svc.adminUpdate(
        String(req.params['id'] ?? ''), req.body,
        { id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId },
      )
      sendSuccess(res, { path })
    } catch (err) {
      next(err)
    }
  },
)

/* DELETE /learning-paths/:id */
router.delete(
  '/:id',
  authenticateAny,
  requireRole('super_admin', 'admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.adminDelete(
        String(req.params['id'] ?? ''),
        { id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId },
      )
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
)

export default router
