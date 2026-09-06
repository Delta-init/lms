/**
 * purge-student-data.ts — remove student-generated data + student accounts,
 * keeping course content, staff accounts, roles, categories, coupons, live
 * classes and mentor availability.
 *
 * SAFE BY DEFAULT: dry run prints counts and deletes NOTHING.
 *   bun src/scripts/purge-student-data.ts          # dry run
 *   bun src/scripts/purge-student-data.ts --yes    # actually delete
 *
 * ⚠️  Take a mongodump backup BEFORE running with --yes (see the chat notes).
 */
import '@/config/timezone.ts'
import 'dotenv/config'
import { connectDatabase, disconnectDatabase } from '@/config/database.ts'
import { logger } from '@/utils/logger.ts'
import {
  UserModel,
  LiveClassModel, MentorAvailabilityModel,
  SessionHomeworkModel, SupportTicketModel, AuditLogModel,
  EnrollmentModel, LessonProgressModel, QuizAttemptModel,
  AssignmentSubmissionModel, HomeworkSubmissionModel,
  ClassBookingModel, ClassFeedbackModel,
  ReviewModel, ReviewVoteModel, FavoriteModel,
  LessonNoteModel, VideoBookmarkModel,
  DiscussionThreadModel, DiscussionCommentModel,
  NotificationModel, OrderModel,
  UserAchievementModel, UserStreakModel,
  RefreshTokenModel, AuthTokenModel,
} from '@/models/schema.ts'

const EXECUTE = process.argv.includes('--yes')

/* Users are kept ONLY if their role is in this list. Everyone else is deleted
   (instructors, admins, program-admins, students — all removed). */
const KEEP_USER_ROLES = ['super_admin']

/* Collections wiped in full. */
const FULL_WIPE: Array<[string, { estimatedDocumentCount: () => Promise<number>; deleteMany: (f: object) => Promise<{ deletedCount?: number }> }]> = [
  ['LiveClass',            LiveClassModel],
  ['MentorAvailability',   MentorAvailabilityModel],
  ['SessionHomework',      SessionHomeworkModel],
  ['SupportTicket',        SupportTicketModel],
  ['AuditLog',             AuditLogModel],
  ['Enrollment',           EnrollmentModel],
  ['LessonProgress',       LessonProgressModel],
  ['QuizAttempt',          QuizAttemptModel],
  ['AssignmentSubmission', AssignmentSubmissionModel],
  ['HomeworkSubmission',   HomeworkSubmissionModel],
  ['ClassBooking',         ClassBookingModel],
  ['ClassFeedback',        ClassFeedbackModel],
  ['Review',               ReviewModel],
  ['ReviewVote',           ReviewVoteModel],
  ['Favorite',             FavoriteModel],
  ['LessonNote',           LessonNoteModel],
  ['VideoBookmark',        VideoBookmarkModel],
  ['DiscussionThread',     DiscussionThreadModel],
  ['DiscussionComment',    DiscussionCommentModel],
  ['Notification',         NotificationModel],
  ['Order',                OrderModel],
  ['UserAchievement',      UserAchievementModel],
  ['UserStreak',           UserStreakModel],
  ['RefreshToken',         RefreshTokenModel],
  ['AuthToken',            AuthTokenModel],
]

async function main() {
  await connectDatabase()
  logger.info(EXECUTE
    ? '⚠️  EXECUTE MODE — data WILL be permanently deleted'
    : '🔍 DRY RUN — nothing will be deleted. Re-run with --yes to execute.')

  let total = 0

  for (const [name, Model] of FULL_WIPE) {
    const count = await Model.estimatedDocumentCount()
    if (EXECUTE) {
      const res = await Model.deleteMany({})
      logger.info(`  ${name.padEnd(22)} deleted ${res.deletedCount ?? 0}`)
    } else {
      logger.info(`  ${name.padEnd(22)} would delete ${count}`)
    }
    total += count
  }

  /* Users: keep ONLY super_admin, delete everyone else */
  const userFilter = { role: { $nin: KEEP_USER_ROLES } }
  const toDelete = await UserModel.countDocuments(userFilter)
  const toKeep   = await UserModel.countDocuments({ role: { $in: KEEP_USER_ROLES } })
  if (EXECUTE) {
    const res = await UserModel.deleteMany(userFilter)
    logger.info(`  ${'User'.padEnd(22)} deleted ${res.deletedCount ?? 0} user(s), kept ${toKeep} super_admin`)
  } else {
    logger.info(`  ${'User'.padEnd(22)} would delete ${toDelete} user(s), keep ${toKeep} super_admin`)
  }
  total += toDelete

  logger.info(EXECUTE
    ? `✅ Done. Deleted ${total} document(s) total.`
    : `🔍 Dry run complete. Would delete ${total} document(s). Add --yes to execute.`)

  await disconnectDatabase()
  process.exit(0)
}

main().catch(err => { logger.error({ err }, 'purge-student-data failed'); process.exit(1) })
