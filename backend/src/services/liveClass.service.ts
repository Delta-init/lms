import { Types } from 'mongoose'
import { LiveClassRepository } from '@/repositories/liveClass.repository.ts'
import { CourseRepository } from '@/repositories/course.repository.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import { sendLiveClassScheduled } from '@/services/email.service.ts'
import * as muxSvc from '@/services/mux.service.ts'
import { fetchMeetRecordingUrl } from '@/services/googleMeet.service.ts'
import { logger } from '@/utils/logger.ts'
import { env } from '@/config/env.ts'
import { EnrollmentModel, LiveClassModel, type ILiveClass, type LiveClassType } from '@/models/schema.ts'

export class LiveClassError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'LiveClassError'
  }
}

export class LiveClassService {
  private readonly liveRepo   = new LiveClassRepository()
  private readonly courseRepo = new CourseRepository()
  private readonly enrollRepo = new EnrollmentRepository()

  /* ── Public list — slug-based for the course page ─── */
  /* Admin — list all live classes across all courses */
  async listAll(filter: { status?: string; limit?: number; courseIds?: string[]; organizationId?: string; instructorId?: string } = {}): Promise<ILiveClass[]> {
    return this.liveRepo.listAll(filter)
  }

  async getById(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    /* When live, refresh viewer count from Mux monitoring API in the background.
       We fire-and-forget so the response is still fast — next poll gets updated count. */
    if (live.status === 'live' && live.type === 'internal' && env.MUX_TOKEN_ID) {
      void muxSvc.getLiveViewerCount().then(async count => {
        await LiveClassModel.updateOne({ _id: live._id }, { $set: { viewerCount: count } })
      }).catch(() => {/* non-fatal */})
    }

    return live
  }

  async listForCourseSlug(slug: string, userId?: string): Promise<(ILiveClass & { isEnrolled: boolean; isEntitled: boolean })[]> {
    const course = await this.courseRepo.findBySlug(slug)
    if (!course) throw new LiveClassError('COURSE_NOT_FOUND', 'Course not found', 404)
    const sessions = await this.liveRepo.listForCourse(course.id)

    let enrolled = false
    let blockedSectionIds: string[] = []
    if (userId) {
      const enrollments = await this.enrollRepo.listForUser(userId)
      const courseIdStr = String(course.id)
      /* 'active' and 'completed' both keep access — only 'dropped' loses it. */
      const enrollment  = enrollments.find(e => {
        const cId = e.courseId && typeof e.courseId === 'object'
          ? String((e.courseId as { _id?: unknown })._id ?? '')
          : String(e.courseId)
        return cId === courseIdStr && e.status !== 'dropped'
      })
      enrolled = !!enrollment
      /* blockedLessons stores SECTION ids (field name is a legacy misnomer). */
      blockedSectionIds = (enrollment?.blockedLessons ?? []).map(bid => String(bid))
    }

    return sessions.map(s => Object.assign(s, {
      isEnrolled: enrolled,
      /* A blocked module is never entitled — mirrors the /watch gate below. */
      isEntitled: enrolled && !(s.sectionId && blockedSectionIds.includes(String(s.sectionId))),
    }))
  }

  async listForCourseId(courseId: string): Promise<ILiveClass[]> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new LiveClassError('INVALID_ID', 'Invalid course id', 400)
    }
    return this.liveRepo.listForCourse(courseId)
  }

  /* ── Upcoming feed — all sessions, annotated with isEnrolled ─────────────── */
  async listUpcomingForUser(userId: string, limit = 50, categoryFilter?: string): Promise<(ILiveClass & { isEnrolled: boolean; isEntitled: boolean })[]> {
    // Find which courses the user has purchased so we can annotate isEnrolled.
    // 'active' and 'completed' both keep access — only 'dropped' loses it.
    // blockedLessons stores SECTION ids (legacy misnomer): a session inside a
    // blocked module is not entitled even though the course enrolment is.
    const enrollments       = await this.enrollRepo.listForUser(userId)
    const enrolledCourseIds = new Set<string>()
    const blockedByCourse   = new Map<string, string[]>()
    for (const e of enrollments) {
      if (e.status === 'dropped') continue
      const cId = e.courseId && typeof e.courseId === 'object'
        ? String((e.courseId as { _id?: unknown })._id ?? '')
        : String(e.courseId)
      if (!cId) continue
      enrolledCourseIds.add(cId)
      blockedByCourse.set(cId, (e.blockedLessons ?? []).map(bid => String(bid)))
    }

    // If student has a category, restrict to that category's courses
    let courseIds: string[] | undefined
    if (categoryFilter) {
      const { CourseModel } = await import('@/models/schema.ts')
      const courses = await CourseModel.find({ program: categoryFilter }, { _id: 1 }).lean()
      courseIds = courses.map((c: any) => String(c._id))
      // No courses in this category → return empty rather than showing all sessions
      if (courseIds.length === 0) return []
    }

    // Return upcoming sessions (optionally filtered by category's courseIds)
    const sessions = await this.liveRepo.listAllUpcoming(limit, courseIds)

    return sessions
      .slice()
      .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
      .slice(0, limit)
      .map(s => {
        const rawId = (s as any).courseId
        const courseId = rawId && typeof rawId === 'object'
          ? String((rawId as any)._id ?? (rawId as any).id ?? '')
          : String(rawId ?? '')
        const rawSection = (s as any).sectionId
        /* sectionId is not populated here — never read `.id` off an ObjectId. */
        const sectionId  = rawSection ? String((rawSection as any)._id ?? rawSection) : ''
        const isEnrolled = enrolledCourseIds.has(courseId)
        const isEntitled = isEnrolled &&
          !(sectionId && (blockedByCourse.get(courseId) ?? []).includes(sectionId))
        return Object.assign(s, { isEnrolled, isEntitled })
      })
  }

  /* ── Admin/instructor create ──────────────────────── */
  async create(input: {
    courseId:         string
    instructorId:     string
    title:            string
    description?:     string
    scheduledStart:   Date
    durationMins:     number
    type:             LiveClassType
    meetingUrl?:      string
    googleMeetCode?:  string
    sectionId?:       string
    sessionCapacity?: number
    language?:        string
    isOnline?:        boolean
    location?:        string
    room?:            string
    organizationId?:  string
    seriesId?:        string
  }): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(input.courseId)) {
      throw new LiveClassError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }
    const course = await this.courseRepo.findById(input.courseId)
    if (!course) throw new LiveClassError('COURSE_NOT_FOUND', 'Course not found', 404)

    /* Validate meetingUrl is provided for online external sessions */
    if (input.type === 'external' && input.isOnline !== false) {
      if (!input.meetingUrl?.trim()) {
        throw new LiveClassError('MEETING_URL_REQUIRED', 'meetingUrl is required for external live classes', 400)
      }
    }

    let muxData: { streamId: string; streamKey: string; playbackId: string } | null = null

    /* Create Mux stream for online internal sessions */
    if (input.type === 'internal' && input.isOnline !== false) {
      if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
        throw new LiveClassError(
          'MUX_NOT_CONFIGURED',
          'In-app streaming is not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.',
          503,
        )
      }
      muxData = await muxSvc.createLiveStream()
    }

    const doc: Partial<ILiveClass> = {
      courseId:        new Types.ObjectId(input.courseId),
      instructorId:    new Types.ObjectId(input.instructorId),
      title:           input.title.trim(),
      description:     input.description,
      scheduledStart:  input.scheduledStart,
      durationMins:    input.durationMins,
      type:            input.type,
      status:          'scheduled',
      sessionCapacity: input.sessionCapacity ?? 30,
      bookedCount:     0,
      language:        input.language ?? 'English',
      isOnline:        input.isOnline ?? true,
    }
    if (input.location) (doc as any).location = input.location.trim()
    if (input.room)     (doc as any).room     = input.room.trim()
    if (input.organizationId && Types.ObjectId.isValid(input.organizationId)) {
      ;(doc as any).organizationId = new Types.ObjectId(input.organizationId)
    }
    if (input.seriesId && Types.ObjectId.isValid(input.seriesId)) {
      doc.seriesId = new Types.ObjectId(input.seriesId)
    }

    if (input.sectionId && Types.ObjectId.isValid(input.sectionId)) {
      doc.sectionId = new Types.ObjectId(input.sectionId)
    }

    if (input.type === 'external' && input.meetingUrl) {
      doc.meetingUrl = input.meetingUrl.trim()
      if (input.googleMeetCode) doc.googleMeetCode = input.googleMeetCode
    }

    if (muxData) {
      doc.muxLiveStreamId = muxData.streamId
      doc.muxStreamKey    = muxData.streamKey
      doc.muxPlaybackId   = muxData.playbackId
    }

    const created = await this.liveRepo.createOne(doc)

    /* Fire-and-forget notification to enrolled students */
    void this.#notifyEnrolledStudents(created, course.title, course.slug).catch(err =>
      logger.warn({ err, liveClassId: created.id }, 'live-class notification failed'),
    )

    return created
  }

  /* ── Start an internal stream (instructor going live) */
  async startStream(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'Only internal (Mux) live classes can be started this way', 400)
    }
    if (live.status === 'live') {
      throw new LiveClassError('ALREADY_LIVE', 'Stream is already live', 400)
    }
    if (live.status === 'ended' || live.status === 'cancelled') {
      throw new LiveClassError('STREAM_ENDED', `Cannot start a stream with status "${live.status}"`, 400)
    }
    if (!live.muxLiveStreamId) {
      throw new LiveClassError('NO_STREAM_ID', 'No Mux stream ID found for this class', 500)
    }

    try {
      await muxSvc.enableLiveStream(live.muxLiveStreamId)
    } catch (err) {
      const msg = ((err as Error).message ?? '').toLowerCase()
      logger.error({ err, id }, 'mux: failed to enable live stream')

      if (msg.includes('disabled')) {
        /* Stream key was explicitly disabled — user must recreate */
        throw new LiveClassError(
          'MUX_ERROR',
          'Could not start the stream: stream key has been disabled, please recreate the class',
          502,
        )
      }

      /* Any other error (e.g. "stream is not in a disabled state" — stream is already
         idle/enabled after recreate): non-fatal. The stream is ready to receive RTMP. */
      logger.warn({ err, id }, 'mux: enableLiveStream non-fatal error — stream already idle, proceeding')
    }

    const updated = await this.liveRepo.updateByIdPopulated(id, {
      status:    'live',
      startedAt: new Date(),
    } as Partial<ILiveClass>)

    return updated!
  }

  /* ── End an internal stream ───────────────────────── */
  async endStream(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'Only internal (Mux) live classes can be ended this way', 400)
    }
    if (live.status !== 'live' && live.status !== 'scheduled') {
      throw new LiveClassError('NOT_LIVE', `Stream is not live (current status: "${live.status}")`, 400)
    }
    if (!live.muxLiveStreamId) {
      throw new LiveClassError('NO_STREAM_ID', 'No Mux stream ID found for this class', 500)
    }

    await muxSvc.disableLiveStream(live.muxLiveStreamId)

    const updated = await this.liveRepo.updateByIdPopulated(id, {
      status:  'ended',
      endedAt: new Date(),
    } as Partial<ILiveClass>)

    return updated!
  }

  /* ── Stream credentials (admin only) ─────────────── */
  async getStreamCredentials(id: string): Promise<{ rtmpUrl: string; streamKey: string; playbackId: string }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    /* select:false field — must explicitly include muxStreamKey */
    const live = await LiveClassModel
      .findById(id)
      .select('+muxStreamKey')
      .exec()

    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'No RTMP credentials for external live classes', 400)
    }
    if (!live.muxStreamKey || !live.muxPlaybackId) {
      throw new LiveClassError('NO_CREDENTIALS', 'Stream credentials not found', 500)
    }

    return {
      rtmpUrl:    muxSvc.MUX_RTMP_URL,
      streamKey:  live.muxStreamKey,
      playbackId: live.muxPlaybackId,
    }
  }

  /* ── Student watch access ─────────────────────────── */
  async getWatchAccess(id: string, userId: string): Promise<{
    type:          'external' | 'internal'
    title:         string
    status:        string
    meetingUrl?:   string
    playbackUrl?:  string
    recordingUrl?: string
    thumbnailUrl?: string
    viewerCount:   number
  }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    /* Access gate: student must be enrolled in (purchased) the course */
    const rawCourseId = live.courseId as unknown
    const courseId =
      rawCourseId instanceof Types.ObjectId
        ? rawCourseId
        : (rawCourseId as { _id?: Types.ObjectId })?._id ?? String(rawCourseId)
    const enrollment = await this.enrollRepo.findByUserCourse(userId, courseId).catch(() => null)

    if (!enrollment) {
      throw new LiveClassError('NOT_ENROLLED', 'You must be enrolled in this course to watch this session', 403)
    }

    /* Module access gate — mirrors the booking route. Note: blockedLessons
       actually stores section/module IDs (field name is a legacy misnomer). */
    if (live.sectionId) {
      const blockedIds = (enrollment.blockedLessons ?? []).map(bid => String(bid))
      if (blockedIds.includes(String(live.sectionId))) {
        throw new LiveClassError('MODULE_BLOCKED', 'You don\'t have access to this module. Contact your admin.', 403)
      }
    }

    if (live.status === 'cancelled') {
      throw new LiveClassError('SESSION_CANCELLED', 'This session was cancelled', 410)
    }

    if (live.type === 'external') {
      return {
        type:       'external',
        title:      live.title,
        status:     live.status,
        meetingUrl: live.meetingUrl,
        viewerCount: 0,
        // recordingUrl intentionally excluded — admin-only, not exposed to students
      }
    }

    /* Internal (Mux) */
    return {
      type:        'internal',
      title:       live.title,
      status:      live.status,
      playbackUrl: live.muxPlaybackId
        ? muxSvc.buildPlaybackUrl(live.muxPlaybackId)
        : undefined,
      recordingUrl: live.recordingUrl ?? undefined,
      thumbnailUrl: live.muxPlaybackId
        ? muxSvc.buildThumbnailUrl(live.muxPlaybackId)
        : undefined,
      viewerCount: live.viewerCount ?? 0,
    }
  }

  /* ── Handle Mux webhook events ───────────────────── */
  async handleMuxWebhook(event: { type: string; data: Record<string, unknown> }): Promise<void> {
    const streamId = event.data['id'] as string | undefined

    switch (event.type) {

      /* Stream went live — update status idempotently + kick off viewer count fetch */
      case 'video.live_stream.active': {
        if (!streamId) return
        await LiveClassModel.updateOne(
          { muxLiveStreamId: streamId, status: { $in: ['scheduled', 'live'] } },
          { $set: { status: 'live', startedAt: new Date() } },
        )
        /* Kick off viewer count refresh */
        if (env.MUX_TOKEN_ID) {
          void muxSvc.getLiveViewerCount().then(count =>
            LiveClassModel.updateOne({ muxLiveStreamId: streamId }, { $set: { viewerCount: count } })
          ).catch(() => {})
        }
        logger.info({ streamId }, 'mux webhook: stream active')
        break
      }

      /* Stream went idle — instructor stopped streaming */
      case 'video.live_stream.idle': {
        if (!streamId) return
        await LiveClassModel.updateOne(
          { muxLiveStreamId: streamId, status: 'live' },
          { $set: { status: 'ended', endedAt: new Date() } },
        )
        logger.info({ streamId }, 'mux webhook: stream idle → ended')
        break
      }

      /* Stream disconnected — instructor dropped (within reconnect window, may reconnect) */
      case 'video.live_stream.disconnected': {
        /* Don't change status — Mux may reconnect within reconnect_window (60s).
           If it doesn't reconnect, video.live_stream.idle fires. */
        logger.info({ streamId }, 'mux webhook: stream disconnected (waiting for reconnect)')
        break
      }

      /* Recording asset is ready — save recording URL */
      case 'video.asset.ready': {
        const assetId    = event.data['id'] as string
        const liveStream = event.data['live_stream_id'] as string | undefined
        if (!liveStream) return

        const playbackIds = event.data['playback_ids'] as Array<{ id: string; policy: string }> | undefined
        const assetPlaybackId = playbackIds?.[0]?.id

        if (assetPlaybackId) {
          const recordingUrl = muxSvc.buildRecordingUrl(assetPlaybackId)
          await LiveClassModel.updateOne(
            { muxLiveStreamId: liveStream },
            { $set: { muxAssetId: assetId, recordingUrl } },
          )
          logger.info({ liveStream, assetId, recordingUrl }, 'mux webhook: recording ready')
        }
        break
      }

      default:
        logger.debug({ type: event.type }, 'mux webhook: unhandled event type')
    }
  }

  /* ── Recreate Mux stream (when key is disabled) ──── */
  async recreateStream(id: string): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)
    if (live.type !== 'internal') {
      throw new LiveClassError('NOT_INTERNAL', 'Only internal (Mux) live classes have stream credentials', 400)
    }
    if (live.status === 'live') {
      throw new LiveClassError('ALREADY_LIVE', 'Cannot recreate credentials while stream is live', 400)
    }
    if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
      throw new LiveClassError('MUX_NOT_CONFIGURED', 'Mux credentials not configured', 503)
    }

    /* Best-effort delete old stream — non-fatal if already gone on Mux's side */
    if (live.muxLiveStreamId) {
      await muxSvc.deleteLiveStream(live.muxLiveStreamId)
    }

    /* Create a fresh Mux live stream */
    const muxData = await muxSvc.createLiveStream()

    const updated = await this.liveRepo.updateByIdPopulated(id, {
      muxLiveStreamId: muxData.streamId,
      muxStreamKey:    muxData.streamKey,
      muxPlaybackId:   muxData.playbackId,
      status:          'scheduled',
      startedAt:       undefined,
      endedAt:         undefined,
      viewerCount:     0,
    } as unknown as Partial<ILiveClass>)

    if (!updated) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    logger.info({ id, newStreamId: muxData.streamId }, 'live-class: stream recreated')
    return updated
  }

  /* ── Update ──────────────────────────────────────── */
  async update(id: string, input: Partial<{
    title:             string
    description:       string
    scheduledStart:    Date
    durationMins:      number
    meetingUrl:        string
    recordingUrl:      string
    status:            'scheduled' | 'live' | 'ended' | 'cancelled'
    sessionCapacity:   number
    mentorNotes:       string
    instructorId:      string
    courseId:          string
    sectionId:         string
    language:          string
    isOnline:          boolean
    location:          string
    room:              string
    rescheduledReason: string
  }>): Promise<ILiveClass> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }

    // Snapshot current doc so we can detect status transitions for recording poll
    const current = await LiveClassModel.findById(id).select('type status googleMeetCode recordingUrl').lean()

    const patch: Partial<ILiveClass> = { ...(input as any) }
    if (input.instructorId != null) {
      if (!Types.ObjectId.isValid(input.instructorId)) throw new LiveClassError('INVALID_ID', 'Invalid instructorId', 400)
      patch.instructorId = new Types.ObjectId(input.instructorId) as any
    }
    if (input.courseId != null) {
      if (!Types.ObjectId.isValid(input.courseId)) throw new LiveClassError('INVALID_ID', 'Invalid courseId', 400)
      patch.courseId = new Types.ObjectId(input.courseId) as any
    }
    if (input.sectionId != null) {
      if (!Types.ObjectId.isValid(input.sectionId)) throw new LiveClassError('INVALID_ID', 'Invalid sectionId', 400)
      patch.sectionId = new Types.ObjectId(input.sectionId) as any
    }
    const updated = await this.liveRepo.updateByIdPopulated(id, patch)
    if (!updated) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    // When an external class with a Meet code is marked "ended", auto-poll for recording
    const isNewlyEnded = input.status === 'ended' && current?.status !== 'ended'
    const hasCode      = !!(current as any)?.googleMeetCode
    const noRecording  = !(current as any)?.recordingUrl
    if (isNewlyEnded && current?.type === 'external' && hasCode && noRecording) {
      void this.#pollForMeetRecording(id, (current as any).googleMeetCode)
    }

    return updated
  }

  /* Polls Google Meet API for the recording of an external class.
     Retries every 3 minutes for up to 30 minutes after the class ends. */
  async #pollForMeetRecording(classId: string, meetingCode: string): Promise<void> {
    const INTERVAL_MS  = 3 * 60 * 1000   // 3 minutes between attempts
    const MAX_ATTEMPTS = 10              // up to 30 minutes total

    // Give Meet a few minutes to process the recording before first poll
    await new Promise(r => setTimeout(r, INTERVAL_MS))

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const url = await fetchMeetRecordingUrl(meetingCode)
        if (url) {
          await LiveClassModel.findByIdAndUpdate(classId, { recordingUrl: url })
          logger.info({ classId, meetingCode, url }, 'meet-recording: auto-saved recording URL')
          return
        }
      } catch (err) {
        logger.warn({ err, classId, attempt }, 'meet-recording: poll error')
      }

      logger.debug({ classId, meetingCode, attempt }, 'meet-recording: recording not ready yet')
      await new Promise(r => setTimeout(r, INTERVAL_MS))
    }

    logger.warn({ classId, meetingCode }, 'meet-recording: no recording found after 30 minutes')
  }

  /* ── Delete ──────────────────────────────────────── */
  async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new LiveClassError('INVALID_ID', 'Invalid id', 400)
    }
    const live = await this.liveRepo.findByIdPopulated(id)
    if (!live) throw new LiveClassError('LIVE_CLASS_NOT_FOUND', 'Live class not found', 404)

    /* Cleanup Mux stream if internal */
    if (live.type === 'internal' && live.muxLiveStreamId) {
      await muxSvc.deleteLiveStream(live.muxLiveStreamId)
    }

    await this.liveRepo.hardDelete(id)
  }

  /* ── Helpers ─────────────────────────────────────── */
  async #notifyEnrolledStudents(live: ILiveClass, courseTitle: string, courseSlug: string): Promise<void> {
    const enrolledStudents = await EnrollmentModel
      .find({ courseId: live.courseId, status: { $ne: 'dropped' } })
      .limit(200)
      .populate('userId', '_id email name isActive')
      .exec()

    const courseUrl = `${env.CLIENT_URL}/courses/${courseSlug}`

    const { NotificationService } = await import('@/services/notification.service.ts')
    const notifications = new NotificationService()

    const whenLabel = live.scheduledStart.toLocaleString('en-US',
      { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

    for (const e of enrolledStudents) {
      const u = e.userId as unknown as {
        _id: { toString: () => string }
        email: string
        name: string
        isActive: boolean
      }
      if (!u?.email || u.isActive === false) continue

      try {
        await notifications.create(u._id.toString(), {
          kind:  'live-class-scheduled',
          title: `Live class scheduled in ${courseTitle}`,
          body:  `"${live.title}" — ${whenLabel}`,
          link:  `/live-classes/${live.id}/watch`,
        })
      } catch (err) {
        logger.warn({ err, userId: u._id.toString() }, 'live-class in-app notification failed')
      }

      try {
        await sendLiveClassScheduled(u.email, u.name, courseTitle, live.title, live.scheduledStart, courseUrl)
      } catch (err) {
        logger.warn({ err, email: u.email }, 'live-class email send failed')
      }
    }
  }
}
