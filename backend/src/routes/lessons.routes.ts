import { Router, type Request, type Response, type NextFunction } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { ProgressController }    from '@/controllers/progress.controller.ts'
import { TranscriptController }  from '@/controllers/transcript.controller.ts'
import { SectionService } from '@/services/section.service.ts'
import { TranscriptError } from '@/services/transcript.service.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import { LessonModel } from '@/models/schema.ts'
import { authenticate, requireAdmin, requireInstructor, injectCategoryScope } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'

const router   = Router()
const progress = new ProgressController()
const transcript = new TranscriptController()
const sectionSvc = new SectionService()
const enrollRepo = new EnrollmentRepository()

const watchTimeSchema = z.object({
  secs: z.coerce.number().min(1).max(300),
})

const transcriptSaveSchema = z.object({
  transcript: z.string().max(100_000),
})

/* ── Access guards ────────────────────────────────── */
/* Transcripts are paid content — caller must be enrolled in the owning course. */
const requireLessonEnrollment = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const lessonId = String(req.params['id'] ?? '')
    if (!Types.ObjectId.isValid(lessonId)) throw new TranscriptError('INVALID_ID', 'Invalid lesson id', 400)
    const lesson = await LessonModel.findById(lessonId).select('courseId isFree').lean().exec()
    if (!lesson) throw new TranscriptError('NOT_FOUND', 'Lesson not found', 404)
    if (lesson.isFree) { next(); return }
    const enrolled = await enrollRepo.findByUserCourse(req.user!.id, lesson.courseId)
    if (!enrolled) throw new TranscriptError('NOT_ENROLLED', 'You must be enrolled in this course', 403)
    next()
  } catch (err) { next(err) }
}

/* Writes resolve lesson → course and reject staff who don't own it (admins pass). */
const requireLessonOwnership = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    await sectionSvc.assertLessonEditable(
      String(req.params['id'] ?? ''),
      req.user!.id,
      req.user!.role,
      req.user!.categoryScope,
    )
    next()
  } catch (err) { next(err) }
}

/* ── Progress ─────────────────────────────────────── */
router.get ('/:id/progress',    authenticate, progress.myLessonProgress)
router.post('/:id/complete',    authenticate, progress.markComplete)
router.post('/:id/watch-time',  authenticate, validate(watchTimeSchema), progress.recordWatchTime)

/* ── Transcript ───────────────────────────────────── */
/* Read — enrolled students only */
router.get('/:id/transcript', authenticate, requireLessonEnrollment, transcript.get)
/* Admin/instructor write + AI generation — must own the lesson's course */
router.patch('/:id/transcript',           authenticate, requireInstructor, injectCategoryScope, requireLessonOwnership, validate(transcriptSaveSchema), transcript.save)
router.post ('/:id/generate-transcript',  authenticate, requireInstructor, injectCategoryScope, requireLessonOwnership, transcript.generate)

export default router
