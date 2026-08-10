import { Types } from 'mongoose'
import { LearningPathModel, type ILearningPath } from '@/models/schema.ts'

export class LearningPathRepository {
  private readonly populateOpts = [
    { path: 'instructorId', select: 'name avatarUrl headline' },
    { path: 'categoryId',   select: 'name slug' },
    { path: 'courses.courseId', select: 'title slug thumbnailUrl isFree price level durationMins enrolledCount ratingAvg' },
  ]

  async create(data: Partial<ILearningPath>): Promise<ILearningPath> {
    const doc = new LearningPathModel(data)
    return doc.save()
  }

  async findBySlug(slug: string, populateCourses = false): Promise<ILearningPath | null> {
    const q = LearningPathModel.findOne({ slug })
    if (populateCourses) {
      for (const opt of this.populateOpts) q.populate(opt)
    }
    return q.exec()
  }

  async findById(id: string | Types.ObjectId, populateCourses = false): Promise<ILearningPath | null> {
    const q = LearningPathModel.findById(id)
    if (populateCourses) {
      for (const opt of this.populateOpts) q.populate(opt)
    }
    return q.exec()
  }

  /* ── Academy predicate (P-22) ────────────────────────
     The standard `{org} OR {null} OR {missing}` shape used by every other
     org filter in this codebase: a caller with no academy on record is
     unscoped, and a row that predates the field stays reachable so the boot
     backfill is a safety net rather than a hard dependency. Returns null when
     no scoping applies, so callers can skip the clause entirely. */
  private orgClause(organizationId?: string): Record<string, unknown> | null {
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) return null
    return {
      $or: [
        { organizationId: new Types.ObjectId(organizationId) },
        { organizationId: null },
        { organizationId: { $exists: false } },
      ],
    }
  }

  async listPublished(
    page:    number,
    perPage: number,
    categoryId?: string,
    organizationId?: string,
  ): Promise<{ docs: ILearningPath[]; total: number }> {
    const filter: Record<string, unknown> = { status: 'published' }
    if (categoryId) filter['categoryId'] = new Types.ObjectId(categoryId)
    const scoped = this.orgClause(organizationId)
    if (scoped) Object.assign(filter, scoped)

    const [docs, total] = await Promise.all([
      LearningPathModel
        .find(filter)
        .populate({ path: 'instructorId', select: 'name avatarUrl' })
        .populate({ path: 'categoryId',   select: 'name slug' })
        .sort({ enrolledCount: -1, createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .exec(),
      LearningPathModel.countDocuments(filter),
    ])
    return { docs, total }
  }

  async listAll(
    page: number,
    perPage: number,
    organizationId?: string,
  ): Promise<{ docs: ILearningPath[]; total: number }> {
    const filter: Record<string, unknown> = {}
    const scoped = this.orgClause(organizationId)
    if (scoped) Object.assign(filter, scoped)

    const [docs, total] = await Promise.all([
      LearningPathModel
        .find(filter)
        .populate({ path: 'instructorId', select: 'name avatarUrl' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .exec(),
      LearningPathModel.countDocuments(filter),
    ])
    return { docs, total }
  }

  async update(id: string | Types.ObjectId, patch: Partial<ILearningPath>): Promise<ILearningPath | null> {
    return LearningPathModel.findByIdAndUpdate(id, patch, { new: true }).exec()
  }

  async deleteById(id: string | Types.ObjectId): Promise<void> {
    await LearningPathModel.findByIdAndDelete(id).exec()
  }

  async incrementEnrollment(id: string | Types.ObjectId, delta: number): Promise<void> {
    await LearningPathModel.findByIdAndUpdate(id, { $inc: { enrolledCount: delta } }).exec()
  }
}
