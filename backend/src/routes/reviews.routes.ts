import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ReviewController } from '@/controllers/review.controller.ts'
import { authenticate, requireRole } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { sendSuccess } from '@/utils/response.ts'
import { ReviewService } from '@/services/review.service.ts'

const router  = Router()
const reviews = new ReviewController()
const svc     = new ReviewService()

router.delete('/:id', authenticate, reviews.deleteOwn)

/* 6.2 — instructor / admin reply */
router.patch(
  '/:id/reply',
  authenticate,
  requireRole('super_admin', 'admin', 'instructor'),
  validate(z.object({ reply: z.string().min(1).max(5000) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const review = await svc.replyToReview(
        req.user!.id,
        req.user!.role,
        String(req.params['id'] ?? ''),
        req.body.reply,
      )
      sendSuccess(res, { review })
    } catch (err) {
      next(err)
    }
  },
)

/* 6.3 — helpful vote */
router.post(
  '/:id/helpful',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.vote(req.user!.id, String(req.params['id'] ?? ''), 'helpful')
      sendSuccess(res, result)
    } catch (err) {
      next(err)
    }
  },
)

/* 6.3 — report */
router.post(
  '/:id/report',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.vote(req.user!.id, String(req.params['id'] ?? ''), 'report')
      sendSuccess(res, result)
    } catch (err) {
      next(err)
    }
  },
)

export default router
