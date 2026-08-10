import { Router, type Request, type Response, type NextFunction } from 'express'
import express from 'express'
import { z } from 'zod'
import { LiveClassController } from '@/controllers/liveClass.controller.ts'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { resolveLiveStatus } from '@/utils/liveStatus.ts'
import type { PaginationMeta } from '@/types/index.ts'

const router = Router()
const ctrl   = new LiveClassController()

/* ── Helper ─────────────────────────────────── */
function sendSuccess(res: Response, data: unknown, message = 'OK', status = 200, meta?: PaginationMeta) {
  res.status(status).json({ success: true, data, message, ...(meta && { meta }) })
}

/* Join / stream fields — only entitled (enrolled) students may receive these. */
const ENTITLED_ONLY_FIELDS = [
  'meetingUrl',
  'googleMeetCode',
  'muxLiveStreamId',
  'muxStreamKey',
  'muxPlaybackId',
  'muxAssetId',
  'recordingUrl',
  'playbackUrl',
  'mentorNotes',
] as const

/* Private staff commentary — never sent to a student, entitled or not. */
const STAFF_ONLY_FIELDS = [
  'mentorNotes',
] as const

/* ── GET /live-classes — ALL sessions visible to logged-in students ────────────
   Returns every live class (no enrollment filter) so students can browse what's
   coming up. Each session is annotated with `isEnrolled: boolean` so the UI can
   show a "Purchase to join" prompt instead of the join button for non-enrolled users.
   Join/stream fields are only included for sessions the caller is enrolled in.
   Optionally filter by ?status=scheduled|live|ended|all

   NOT paginated, deliberately: `status` is the EFFECTIVE clock-derived status
   computed per row by resolveLiveStatus(), not a stored field, so it cannot be
   filtered in the query. Paginating first would make ?status= search only the
   current page and silently hide a live session sitting further down the list.
──────────────────────────────────────────────────────────────────────────────── */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { LiveClassModel, EnrollmentModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const userId = req.user!.id
    const status = String(req.query['status'] ?? '')

    // Find which courses this student has purchased. 'active' and 'completed'
    // both keep access — only 'dropped' loses it.
    const enrollments = await EnrollmentModel.find(
      { userId: new Types.ObjectId(userId), status: { $ne: 'dropped' } },
      { courseId: 1, blockedLessons: 1 },
    ).lean()
    const enrolledCourseIds = new Set(enrollments.map((e: any) => String(e.courseId)))
    // blockedLessons stores SECTION ids (field name is a legacy misnomer): a
    // session inside a blocked module is not entitled, even though the course
    // enrolment is — same gate as /watch and POST /bookings.
    const blockedByCourse = new Map<string, string[]>(
      enrollments.map((e: any) => [String(e.courseId), (e.blockedLessons ?? []).map((b: any) => String(b))]),
    )

    // Return sessions for the student's org (or all if no org on record).
    const lcOrgFilter: Record<string, unknown> = {}
    if (req.user?.organizationId && Types.ObjectId.isValid(req.user.organizationId)) {
      lcOrgFilter['organizationId'] = new Types.ObjectId(req.user.organizationId)
    }
    const classes = await LiveClassModel.find(lcOrgFilter)
      .populate('instructorId', 'id name avatarUrl')
      .populate('courseId', 'id title slug thumbnailUrl program')
      .populate('sectionId', 'id title')
      .sort({ scheduledStart: 1 })
      .lean({ virtuals: true })

    const now = Date.now()

    // Annotate with isEnrolled + the effective (clock-based) status:
    // a scheduled session reads 'live' within [start-30m, start+15m], 'ended' after.
    let annotated = (classes as any[]).map(c => {
      const courseId = c.courseId
        ? String((c.courseId as any)?._id ?? (c.courseId as any)?.id ?? c.courseId)
        : null
      const sectionId = c.sectionId
        ? String((c.sectionId as any)?._id ?? c.sectionId)
        : null
      const isEnrolled = courseId ? enrolledCourseIds.has(courseId) : false
      const isEntitled = isEnrolled && !(
        sectionId && courseId && (blockedByCourse.get(courseId) ?? []).includes(sectionId)
      )
      const dto: Record<string, unknown> = {
        ...c,
        id:         c.id ?? String(c._id),
        status:     resolveLiveStatus(c.status, c.scheduledStart, c.durationMins ?? 60, now),
        isEnrolled,
      }
      // Non-entitled students see the listing only — never the way in.
      if (!isEntitled) {
        for (const f of ENTITLED_ONLY_FIELDS) delete dto[f]
      }
      for (const f of STAFF_ONLY_FIELDS) delete dto[f]
      return dto
    })

    // An optional ?status= filter applies to the EFFECTIVE status.
    if (status && status !== 'all') {
      annotated = annotated.filter(c => c['status'] === status)
    }

    sendSuccess(res, annotated)
  } catch (err) { next(err) }
})

/* Upcoming sessions for authenticated user's enrolled courses */
router.get('/upcoming', authenticate, ctrl.upcomingForMe)

/* Student watch access — checks enrollment, returns playback URL or meeting URL */
router.get('/:id/watch', authenticate, ctrl.watchAccess)

/* Mux webhook — must use raw body parser BEFORE json parser for signature verification */
router.post(
  '/mux-webhook',
  express.raw({ type: 'application/json' }),
  ctrl.muxWebhook,
)

/* ─────────────────────────────────────────────────────
   STUDENT HOMEWORK ENDPOINTS
   GET  /live-classes/:id/homework    — view homework for a session
   POST /live-classes/homework/:id/submit — submit homework
─────────────────────────────────────────────────────── */

/* A student may only see/submit homework for a session they booked, or
   whose course they are actively enrolled in. */
async function hasSessionAccess(userId: string, liveClassId: string): Promise<boolean> {
  const { ClassBookingModel, EnrollmentModel, LiveClassModel } = await import('@/models/schema.ts')
  const { Types } = await import('mongoose')
  if (!Types.ObjectId.isValid(liveClassId)) return false

  const booking = await ClassBookingModel.findOne({
    userId:      new Types.ObjectId(userId),
    liveClassId: new Types.ObjectId(liveClassId),
    status:      { $ne: 'cancelled' },
  }).lean()
  if (booking) return true

  const session = await LiveClassModel.findById(liveClassId).select('courseId').lean()
  if (!session?.courseId) return false

  /* 'active' and 'completed' both keep access — only 'dropped' loses it. */
  const enrollment = await EnrollmentModel.findOne({
    userId:   new Types.ObjectId(userId),
    courseId: session.courseId,
    status:   { $ne: 'dropped' },
  }).lean()
  return !!enrollment
}

router.get('/:id/homework', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { SessionHomeworkModel } = await import('@/models/schema.ts')
    const liveClassId = String(req.params['id'] ?? '')
    if (!(await hasSessionAccess(req.user!.id, liveClassId))) {
      res.status(403).json({ success: false, error: { code: 'NOT_ENROLLED', message: 'You must be enrolled in this course to view this homework' } }); return
    }
    const list = await SessionHomeworkModel.find({ liveClassId }).lean({ virtuals: true })
    sendSuccess(res, list)
  } catch (err) { next(err) }
})

const submitHomeworkSchema = z.object({
  submissionText: z.string().max(10000).optional(),
  submissionUrl:  z.string().url().max(500).optional(),
}).refine(d => d.submissionText || d.submissionUrl, { message: 'Provide text or URL' })

router.post('/homework/:id/submit', authenticate, validate(submitHomeworkSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { HomeworkSubmissionModel, SessionHomeworkModel } = await import('@/models/schema.ts')
    const homeworkId = String(req.params['id'] ?? '')
    const hw = await SessionHomeworkModel.findById(homeworkId)
    if (!hw) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Homework not found' } }); return }
    if (!(await hasSessionAccess(req.user!.id, String(hw.liveClassId)))) {
      res.status(403).json({ success: false, error: { code: 'NOT_ENROLLED', message: 'You must be enrolled in this course to submit this homework' } }); return
    }

    const { submissionText, submissionUrl } = req.body as { submissionText?: string; submissionUrl?: string }
    const existing = await HomeworkSubmissionModel.findOne({ homeworkId, userId: req.user!.id })
    if (existing) {
      // Update existing submission
      existing.submissionText = submissionText
      existing.submissionUrl  = submissionUrl
      existing.status         = 'submitted'
      await existing.save()
      sendSuccess(res, existing, 'Submission updated')
      return
    }
    const sub = await HomeworkSubmissionModel.create({
      homeworkId,
      userId: req.user!.id,
      submissionText,
      submissionUrl,
    })
    sendSuccess(res, sub, 'Homework submitted', 201)
  } catch (err) { next(err) }
})

export default router
