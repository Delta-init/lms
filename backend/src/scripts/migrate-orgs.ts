/**
 * migrate-orgs.ts
 *
 * One-time migration: seeds Dubai + Bangalore organizations (idempotent),
 * then assigns every piece of existing content to Dubai, and splits
 * existing users by homeCountry (India → Bangalore, else → Dubai).
 *
 * Run with: bun run migrate-orgs
 */
import 'dotenv/config'
import mongoose, { Types } from 'mongoose'
import { env } from '@/config/env.ts'
import {
  OrganizationModel,
  UserModel,
  CourseModel,
  LiveClassModel,
  EnrollmentModel,
  OrderModel,
  SupportTicketModel,
  CouponModel,
} from '@/models/schema.ts'

async function run() {
  await mongoose.connect(env.DATABASE_URL)
  console.log('Connected to MongoDB')

  /* ── 1. Ensure orgs exist ─────────────────────────── */
  const dubaiOrg = await OrganizationModel.findOneAndUpdate(
    { slug: 'dubai' },
    { $setOnInsert: { name: 'Delta LMS Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer', countryFilter: null } },
    { upsert: true, new: true },
  )
  const bangaloreOrg = await OrganizationModel.findOneAndUpdate(
    { slug: 'bangalore' },
    { $setOnInsert: { name: 'Delta LMS Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay', countryFilter: 'India' } },
    { upsert: true, new: true },
  )
  console.log(`Dubai org:     ${dubaiOrg._id}`)
  console.log(`Bangalore org: ${bangaloreOrg._id}`)

  const dubaiId     = dubaiOrg._id as Types.ObjectId
  const bangaloreId = bangaloreOrg._id as Types.ObjectId

  /* ── 2. Courses → Dubai ───────────────────────────── */
  const courseRes = await CourseModel.updateMany(
    { organizationId: { $exists: false } },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Courses assigned to Dubai: ${courseRes.modifiedCount}`)

  /* ── 3. Live classes → Dubai ──────────────────────── */
  const lcRes = await LiveClassModel.updateMany(
    { organizationId: { $exists: false } },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Live classes assigned to Dubai: ${lcRes.modifiedCount}`)

  /* ── 4. Enrollments → Dubai ───────────────────────── */
  const enrollRes = await EnrollmentModel.updateMany(
    { organizationId: { $exists: false } },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Enrollments assigned to Dubai: ${enrollRes.modifiedCount}`)

  /* ── 5. Orders → Dubai ────────────────────────────── */
  const orderRes = await OrderModel.updateMany(
    { organizationId: { $exists: false } },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Orders assigned to Dubai: ${orderRes.modifiedCount}`)

  /* ── 6. Support tickets → Dubai ───────────────────── */
  const ticketRes = await SupportTicketModel.updateMany(
    { organizationId: { $exists: false } },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Support tickets assigned to Dubai: ${ticketRes.modifiedCount}`)

  /* ── 7. Non-global coupons → Dubai ───────────────── */
  const couponRes = await CouponModel.updateMany(
    { organizationId: { $exists: false } },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Coupons assigned to Dubai: ${couponRes.modifiedCount}`)

  /* ── 8. Users: split by homeCountry ───────────────── */
  // Staff/admins with no org → Dubai
  const staffRes = await UserModel.updateMany(
    {
      role: { $in: ['admin', 'sub_admin', 'support', 'instructor'] },
      organizationId: { $exists: false },
    },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Staff assigned to Dubai: ${staffRes.modifiedCount}`)

  // Students/viewers from India → Bangalore
  const indiaRes = await UserModel.updateMany(
    {
      role: { $in: ['student', 'viewer'] },
      'enrollmentApplication.homeCountry': 'IN',
    },
    { $set: { organizationId: bangaloreId } },
  )
  console.log(`India students/viewers → Bangalore: ${indiaRes.modifiedCount}`)

  // Students/viewers not from India and no org → Dubai
  const dubaiStudRes = await UserModel.updateMany(
    {
      role: { $in: ['student', 'viewer'] },
      'enrollmentApplication.homeCountry': { $ne: 'IN' },
      organizationId: { $exists: false },
    },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Non-India students/viewers → Dubai: ${dubaiStudRes.modifiedCount}`)

  // Students/viewers with no enrollmentApplication at all → Dubai
  const noAppRes = await UserModel.updateMany(
    {
      role: { $in: ['student', 'viewer'] },
      enrollmentApplication: { $exists: false },
      organizationId: { $exists: false },
    },
    { $set: { organizationId: dubaiId } },
  )
  console.log(`Students/viewers (no app) → Dubai: ${noAppRes.modifiedCount}`)

  console.log('\nMigration complete.')
  await mongoose.disconnect()
}

run().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
