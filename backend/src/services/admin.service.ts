import { Types } from 'mongoose'
import {
  UserModel, CourseModel, EnrollmentModel, ReviewModel, OrderModel,
} from '@/models/schema.ts'

/* ─────────────────────────────────────────────────────
   AdminService — dashboard-level stats. Counts only;
   no PII surfaced.
───────────────────────────────────────────────────── */
export class AdminService {
  async getStats(organizationId?: string, program?: string): Promise<{
    totalCourses:     number
    publishedCourses: number
    draftCourses:     number
    totalStudents:    number
    totalInstructors: number
    totalEnrollments: number
    totalReviews:     number
    revenueEstimate:  number
  }> {
    const orgMatch: Record<string, unknown> = {}
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      orgMatch['organizationId'] = new Types.ObjectId(organizationId)
    }
    // Category-scoped sub-admins (forex/digital-marketing/ai) only see counts
    // for their own program — otherwise their stat cards contradict the
    // already-scoped course/enrollment lists shown right next to them.
    const courseMatch: Record<string, unknown> = { ...orgMatch }
    if (program) courseMatch['program'] = program

    /* The enrolments this dashboard is reporting on are the ones sitting on the
       courses it is already showing — so ask that directly.

       Counting EnrollmentModel by its OWN organizationId looks equivalent and
       is not: `enrollmentRepo.create_`, the path behind self-enrolment and
       every purchase, does not write that field. Those rows therefore matched
       nothing, and the card read "0 active enrollments" while the course list
       beside it showed enrolled students on every row. Deriving from the
       courses in scope also keeps the two in step for a programme-scoped
       sub-admin, since both now start from the same `courseMatch`. */
    const scopedCourseIds = (await CourseModel.find(courseMatch, { _id: 1 }).lean())
      .map(c => c._id)

    const [
      totalCourses, publishedCourses, draftCourses,
      totalStudents, totalInstructors,
      totalEnrollments, totalReviews,
      revenueAgg,
    ] = await Promise.all([
      CourseModel.countDocuments(courseMatch).exec(),
      CourseModel.countDocuments({ ...courseMatch, status: 'published' }).exec(),
      CourseModel.countDocuments({ ...courseMatch, status: 'draft' }).exec(),
      /* Students ENROLLED on this academy's courses, not everyone holding a
         student account in it. The two diverge badly: an academy can carry
         hundreds of registered accounts that never enrolled in anything, and
         it can teach students provisioned under a different academy — so the
         old count sat beside the course rows contradicting them. Counting
         distinct people on the courses in scope is the number the rest of this
         dashboard is already about. */
      EnrollmentModel.distinct('userId', { courseId: { $in: scopedCourseIds } })
        .then(ids => ids.length),
      UserModel.countDocuments({ ...orgMatch, role: 'instructor' }).exec(),
      EnrollmentModel.countDocuments({ courseId: { $in: scopedCourseIds } }).exec(),
      ReviewModel.countDocuments({}).exec(),
      OrderModel.aggregate([
        { $match: { ...orgMatch, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).exec(),
    ])

    const revenueCents = revenueAgg[0]?.total ?? 0

    return {
      totalCourses,
      publishedCourses,
      draftCourses,
      totalStudents,
      totalInstructors,
      totalEnrollments,
      totalReviews,
      revenueEstimate: Math.round(revenueCents) / 100,
    }
  }

  async enrollmentsTimeseries(days: number, organizationId?: string): Promise<{ date: string; count: number }[]> {
    const since = new Date()
    since.setUTCHours(0, 0, 0, 0)
    since.setUTCDate(since.getUTCDate() - (days - 1))

    const matchBase: Record<string, unknown> = { createdAt: { $gte: since } }
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      matchBase['organizationId'] = new Types.ObjectId(organizationId)
    }

    const rows = await EnrollmentModel.aggregate([
      { $match: matchBase },
      {
        $group: {
          _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
    ]).exec()

    const byDate = new Map<string, number>()
    for (const r of rows) byDate.set(r._id, r.count)

    const out: { date: string; count: number }[] = []
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setUTCDate(since.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      out.push({ date: key, count: byDate.get(key) ?? 0 })
    }
    return out
  }

  async topCourses(limit: number, organizationId?: string, program?: string): Promise<{
    id:            string
    title:         string
    slug:          string
    enrolledCount: number
    ratingAvg:     number
    thumbnailUrl?: string
  }[]> {
    const filter: Record<string, unknown> = {}
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter['organizationId'] = new Types.ObjectId(organizationId)
    }
    if (program) filter['program'] = program
    const docs = await CourseModel
      .find(filter)
      .sort({ enrolledCount: -1 })
      .limit(limit)
      .select('title slug enrolledCount ratingAvg thumbnailUrl')
      .exec()
    return docs.map(d => ({
      id:            d.id,
      title:         d.title,
      slug:          d.slug,
      enrolledCount: d.enrolledCount ?? 0,
      ratingAvg:     d.ratingAvg ?? 0,
      thumbnailUrl:  d.thumbnailUrl,
    }))
  }

  async completionStats(organizationId?: string): Promise<{
    totalEnrollments: number
    completed:        number
    active:           number
    dropped:          number
    completionRate:   number
  }> {
    const matchBase: Record<string, unknown> = {}
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      matchBase['organizationId'] = new Types.ObjectId(organizationId)
    }

    const rows = await EnrollmentModel.aggregate([
      { $match: matchBase },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).exec()

    let completed = 0, active = 0, dropped = 0
    for (const r of rows) {
      if (r._id === 'completed') completed = r.count
      if (r._id === 'active')    active    = r.count
      if (r._id === 'dropped')   dropped   = r.count
    }
    const eligible = completed + active
    const completionRate = eligible > 0
      ? Math.round((completed / eligible) * 1000) / 10
      : 0
    return {
      totalEnrollments: completed + active + dropped,
      completed,
      active,
      dropped,
      completionRate,
    }
  }
}
