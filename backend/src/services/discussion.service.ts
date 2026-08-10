import { Types } from 'mongoose'
import { DiscussionThreadRepository, DiscussionCommentRepository } from '@/repositories/discussion.repository.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { LessonModel } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

export class DiscussionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'DiscussionError'
  }
}

export class DiscussionService {
  private readonly threadRepo  = new DiscussionThreadRepository()
  private readonly commentRepo = new DiscussionCommentRepository()
  private readonly enrollRepo  = new EnrollmentRepository()
  private readonly notifications = new NotificationService()

  /* ── Threads ────────────────────────────────────────── */

  async createThread(
    userId:  string,
    lessonId: string,
    dto: { title?: string; body: string },
  ) {
    if (!Types.ObjectId.isValid(lessonId)) {
      throw new DiscussionError('INVALID_LESSON_ID', 'Invalid lesson id', 400)
    }
    const lesson = await LessonModel.findById(lessonId).select('courseId').exec()
    if (!lesson) throw new DiscussionError('LESSON_NOT_FOUND', 'Lesson not found', 404)

    const courseId = lesson.courseId.toString()
    const enrolled = await this.enrollRepo.findByUserCourse(userId, courseId)
    if (!enrolled) {
      throw new DiscussionError('NOT_ENROLLED', 'You must be enrolled to post in Q&A', 403)
    }

    return this.threadRepo.create({
      lessonId,
      courseId,
      authorId: userId,
      title:    dto.title,
      body:     dto.body,
    })
  }

  /* Reading the Q&A is gated the same way posting to it already was (P-20).
     Students must be enrolled; teaching and admin staff read freely, matching
     createComment(). Verified UI-safe: DiscussionPanel renders only inside
     /learn/[slug]/[lessonId], which enrolment is required to reach, so no
     preview surface depends on the open read. */
  async listThreads(lessonId: string, page: number, perPage: number, userId?: string, userRole?: string) {
    if (!Types.ObjectId.isValid(lessonId)) {
      throw new DiscussionError('INVALID_LESSON_ID', 'Invalid lesson id', 400)
    }

    if (userRole === 'student' && userId) {
      const lesson = await LessonModel.findById(lessonId).select('courseId isFree').exec()
      if (!lesson) throw new DiscussionError('LESSON_NOT_FOUND', 'Lesson not found', 404)
      if (!lesson.isFree) {
        const enrolled = await this.enrollRepo.findByUserCourse(userId, lesson.courseId.toString())
        if (!enrolled) {
          throw new DiscussionError('NOT_ENROLLED', 'You must be enrolled to view this Q&A', 403)
        }
      }
    }

    return this.threadRepo.listByLesson(lessonId, page, perPage)
  }

  async upvoteThread(userId: string, threadId: string) {
    if (!Types.ObjectId.isValid(threadId)) {
      throw new DiscussionError('INVALID_THREAD_ID', 'Invalid thread id', 400)
    }
    const result = await this.threadRepo.upvote(threadId, userId)
    if (!result) throw new DiscussionError('THREAD_NOT_FOUND', 'Thread not found', 404)
    return result
  }

  async resolveThread(userId: string, userRole: string, threadId: string, isResolved: boolean) {
    if (!Types.ObjectId.isValid(threadId)) {
      throw new DiscussionError('INVALID_THREAD_ID', 'Invalid thread id', 400)
    }
    const thread = await this.threadRepo.findById(threadId)
    if (!thread) throw new DiscussionError('THREAD_NOT_FOUND', 'Thread not found', 404)

    const isAuthor = thread.authorId.toString() === userId
    const canModerate = userRole === 'admin' || userRole === 'instructor'
    if (!isAuthor && !canModerate) {
      throw new DiscussionError('FORBIDDEN', 'Cannot modify this thread', 403)
    }
    return this.threadRepo.setResolved(threadId, isResolved)
  }

  async pinThread(threadId: string, isPinned: boolean) {
    if (!Types.ObjectId.isValid(threadId)) {
      throw new DiscussionError('INVALID_THREAD_ID', 'Invalid thread id', 400)
    }
    return this.threadRepo.setPinned(threadId, isPinned)
  }

  async deleteThread(userId: string, userRole: string, threadId: string) {
    if (!Types.ObjectId.isValid(threadId)) {
      throw new DiscussionError('INVALID_THREAD_ID', 'Invalid thread id', 400)
    }
    const thread = await this.threadRepo.findById(threadId)
    if (!thread) throw new DiscussionError('THREAD_NOT_FOUND', 'Thread not found', 404)

    const isAuthor = thread.authorId.toString() === userId
    if (!isAuthor && userRole !== 'admin') {
      throw new DiscussionError('FORBIDDEN', 'Cannot delete this thread', 403)
    }
    await this.threadRepo.deleteById(threadId)
  }

  /* ── Comments ────────────────────────────────────────── */

  async createComment(
    userId:   string,
    userRole: string,
    threadId: string,
    dto: { body: string; parentId?: string },
  ) {
    if (!Types.ObjectId.isValid(threadId)) {
      throw new DiscussionError('INVALID_THREAD_ID', 'Invalid thread id', 400)
    }
    const thread = await this.threadRepo.findById(threadId)
    if (!thread) throw new DiscussionError('THREAD_NOT_FOUND', 'Thread not found', 404)

    /* Students must be enrolled; instructors & admins bypass */
    if (userRole === 'student') {
      const enrolled = await this.enrollRepo.findByUserCourse(userId, thread.courseId.toString())
      if (!enrolled) {
        throw new DiscussionError('NOT_ENROLLED', 'You must be enrolled to reply', 403)
      }
    }

    const comment = await this.commentRepo.create({
      threadId,
      authorId: userId,
      body:     dto.body,
      parentId: dto.parentId,
    })

    await this.threadRepo.incrementCommentCount(threadId, 1)

    /* Notify thread author on new top-level reply.

       `thread.authorId` arrives POPULATED here, so `.toString()` returned the
       inspected document — "{ name: 'Alice', role: 'student', id: '…' }" —
       rather than the id. Two things broke silently as a result: every reply
       notification failed Mongoose validation ("Cast to ObjectId failed"), so
       thread authors were never told anyone had answered; and the
       self-reply guard compared that same garbage against userId, so it never
       matched and would have notified authors about their own replies. Both
       are fire-and-forget, which is why it never surfaced as an error anyone
       saw — it only showed up in the logs. */
    const authorId = String((thread.authorId as any)?._id ?? thread.authorId)
    if (!dto.parentId && authorId !== userId) {
      void this.notifications.create(authorId, {
        kind:  'system',
        title: 'New reply to your question',
        body:  dto.body.slice(0, 100),
        link:  `/learn/${thread.courseId}/lesson/${thread.lessonId}?tab=qa&thread=${threadId}`,
      }).catch(err => logger.warn({ err }, 'discussion reply notification failed'))
    }

    return comment
  }

  async listComments(threadId: string) {
    if (!Types.ObjectId.isValid(threadId)) {
      throw new DiscussionError('INVALID_THREAD_ID', 'Invalid thread id', 400)
    }
    const [topLevel] = await Promise.all([
      this.commentRepo.listByThread(threadId),
    ])
    return topLevel
  }

  async upvoteComment(userId: string, commentId: string) {
    if (!Types.ObjectId.isValid(commentId)) {
      throw new DiscussionError('INVALID_COMMENT_ID', 'Invalid comment id', 400)
    }
    const result = await this.commentRepo.upvote(commentId, userId)
    if (!result) throw new DiscussionError('COMMENT_NOT_FOUND', 'Comment not found', 404)
    return result
  }

  async markInstructorAnswer(commentId: string, mark: boolean) {
    if (!Types.ObjectId.isValid(commentId)) {
      throw new DiscussionError('INVALID_COMMENT_ID', 'Invalid comment id', 400)
    }
    return this.commentRepo.markInstructorAnswer(commentId, mark)
  }

  async deleteComment(userId: string, userRole: string, commentId: string) {
    if (!Types.ObjectId.isValid(commentId)) {
      throw new DiscussionError('INVALID_COMMENT_ID', 'Invalid comment id', 400)
    }
    const comment = await this.commentRepo.findById(commentId)
    if (!comment) throw new DiscussionError('COMMENT_NOT_FOUND', 'Comment not found', 404)

    const isAuthor = comment.authorId.toString() === userId
    if (!isAuthor && userRole !== 'admin') {
      throw new DiscussionError('FORBIDDEN', 'Cannot delete this comment', 403)
    }

    await this.commentRepo.deleteById(commentId)
    await this.threadRepo.incrementCommentCount(comment.threadId.toString(), -1)
  }
}
