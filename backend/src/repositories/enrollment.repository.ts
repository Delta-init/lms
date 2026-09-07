import { Types } from 'mongoose'
import { BaseRepository } from './base.repository.ts'
import { EnrollmentModel, type IEnrollment, type EnrollmentSource } from '@/models/schema.ts'

export class EnrollmentRepository extends BaseRepository<IEnrollment> {
  constructor() {
    super(EnrollmentModel)
  }

  async findByUserCourse(
    userId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
  ): Promise<IEnrollment | null> {
    return EnrollmentModel.findOne({ userId, courseId }).exec()
  }

  async listForUser(userId: string | Types.ObjectId): Promise<IEnrollment[]> {
    return EnrollmentModel
      .find({ userId })
      .sort({ updatedAt: -1 })
      .populate({
        path: 'courseId',
        populate: [
          { path: 'instructorId', select: 'name avatarUrl' },
          { path: 'categoryId',   select: 'name slug' },
        ],
      })
      .exec()
  }

  /* `source` is REQUIRED, not optional with a default. Every caller has to
     say how this enrolment came about, because nothing downstream can work it
     out later — an admin grant and a bulk import produce identical rows. A
     required argument makes the next new enrolment path answer the question
     at compile time instead of silently landing as 'unknown'. */
  async create_(data: {
    userId:   string | Types.ObjectId
    courseId: string | Types.ObjectId
    source:   EnrollmentSource
  }): Promise<IEnrollment> {
    return EnrollmentModel.create({
      userId:          data.userId,
      courseId:        data.courseId,
      status:          'active',
      source:          data.source,
      progressPercent: 0,
      enrolledAt:      new Date(),
    })
  }

  async updateProgress(
    enrollmentId: string | Types.ObjectId,
    update: { progressPercent: number; status?: 'active' | 'completed' | 'dropped'; completedAt?: Date; lastLessonId?: string | Types.ObjectId },
  ): Promise<void> {
    await EnrollmentModel.updateOne({ _id: enrollmentId }, { $set: update }).exec()
  }

  async setLastLesson(
    enrollmentId: string | Types.ObjectId,
    lessonId: string | Types.ObjectId,
  ): Promise<void> {
    await EnrollmentModel.updateOne(
      { _id: enrollmentId },
      { $set: { lastLessonId: lessonId } },
    ).exec()
  }
}
