import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticate, requireRole } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { sendSuccess, parsePagination, buildPaginationMeta } from '@/utils/response.ts'
import { DiscussionService } from '@/services/discussion.service.ts'

const router = Router()
const svc    = new DiscussionService()

/* ── Threads ────────────────────────────────────────── */

const createThreadSchema = z.object({
  title: z.string().max(255).optional(),
  body:  z.string().min(1).max(10000),
})

/* GET /lessons/:lessonId/threads?page=1&per_page=20 */
router.get(
  '/lessons/:lessonId/threads',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const { docs, total } = await svc.listThreads(
        String(req.params['lessonId'] ?? ''), page, per_page, req.user!.id, req.user!.role,
      )
      sendSuccess(res, { threads: docs, meta: buildPaginationMeta(total, page, per_page) })
    } catch (err) {
      next(err)
    }
  },
)

/* POST /lessons/:lessonId/threads */
router.post(
  '/lessons/:lessonId/threads',
  authenticate,
  validate(createThreadSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const thread = await svc.createThread(req.user!.id, String(req.params['lessonId'] ?? ''), req.body)
      sendSuccess(res, { thread }, 'Thread created', 201)
    } catch (err) {
      next(err)
    }
  },
)

/* POST /threads/:threadId/upvote */
router.post(
  '/threads/:threadId/upvote',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const thread = await svc.upvoteThread(req.user!.id, String(req.params['threadId'] ?? ''))
      sendSuccess(res, { thread })
    } catch (err) {
      next(err)
    }
  },
)

/* PATCH /threads/:threadId/resolve */
router.patch(
  '/threads/:threadId/resolve',
  authenticate,
  validate(z.object({ isResolved: z.boolean() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const thread = await svc.resolveThread(
        req.user!.id,
        req.user!.role,
        String(req.params['threadId'] ?? ''),
        req.body.isResolved,
      )
      sendSuccess(res, { thread })
    } catch (err) {
      next(err)
    }
  },
)

/* PATCH /threads/:threadId/pin  (admin/instructor only) */
router.patch(
  '/threads/:threadId/pin',
  authenticate,
  requireRole('super_admin', 'admin', 'instructor'),
  validate(z.object({ isPinned: z.boolean() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const thread = await svc.pinThread(String(req.params['threadId'] ?? ''), req.body.isPinned)
      sendSuccess(res, { thread })
    } catch (err) {
      next(err)
    }
  },
)

/* DELETE /threads/:threadId */
router.delete(
  '/threads/:threadId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.deleteThread(req.user!.id, req.user!.role, String(req.params['threadId'] ?? ''))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
)

/* ── Comments ────────────────────────────────────────── */

const createCommentSchema = z.object({
  body:     z.string().min(1).max(10000),
  parentId: z.string().optional(),
})

/* GET /threads/:threadId/comments */
router.get(
  '/threads/:threadId/comments',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comments = await svc.listComments(String(req.params['threadId'] ?? ''))
      sendSuccess(res, { comments })
    } catch (err) {
      next(err)
    }
  },
)

/* POST /threads/:threadId/comments */
router.post(
  '/threads/:threadId/comments',
  authenticate,
  validate(createCommentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await svc.createComment(
        req.user!.id,
        req.user!.role,
        String(req.params['threadId'] ?? ''),
        req.body,
      )
      sendSuccess(res, { comment }, 'Comment created', 201)
    } catch (err) {
      next(err)
    }
  },
)

/* POST /comments/:commentId/upvote */
router.post(
  '/comments/:commentId/upvote',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await svc.upvoteComment(req.user!.id, String(req.params['commentId'] ?? ''))
      sendSuccess(res, { comment })
    } catch (err) {
      next(err)
    }
  },
)

/* PATCH /comments/:commentId/instructor-answer (instructor/admin) */
router.patch(
  '/comments/:commentId/instructor-answer',
  authenticate,
  requireRole('super_admin', 'admin', 'instructor'),
  validate(z.object({ mark: z.boolean() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = await svc.markInstructorAnswer(String(req.params['commentId'] ?? ''), req.body.mark)
      sendSuccess(res, { comment })
    } catch (err) {
      next(err)
    }
  },
)

/* DELETE /comments/:commentId */
router.delete(
  '/comments/:commentId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.deleteComment(req.user!.id, req.user!.role, String(req.params['commentId'] ?? ''))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
)

export default router
