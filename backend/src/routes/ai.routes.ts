import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { searchRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { sendSuccess } from '@/utils/response.ts'
import { AIService } from '@/services/ai.service.ts'

const router = Router()
const svc    = new AIService()

const chatSchema = z.object({
  message:    z.string().min(1).max(4000),
  lessonId:   z.string().optional(),
  courseSlug: z.string().optional(),
  history:    z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(20).optional().default([]),
})

/* POST /ai/chat */
/* authenticate BEFORE searchRateLimit (P-24). clientKey() prefers req.user.id
   over an address, but only sees it if the session has already been resolved —
   mounted the other way round the AI limiter could only ever bucket by IP, so
   one person on a shared network exhausted everyone's allowance and the
   per-user quota L-09 calls for was unreachable. */
router.post(
  '/chat',
  authenticate,
  searchRateLimit,
  validate(chatSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { message, lessonId, courseSlug, history } = req.body as z.infer<typeof chatSchema>
      const reply = await svc.chat(req.user!.id, history, message, lessonId, courseSlug)
      sendSuccess(res, { reply })
    } catch (err) {
      next(err)
    }
  },
)

export default router
