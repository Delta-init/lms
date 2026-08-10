import '@/config/timezone.ts'   // MUST be first — pins the process to UAE time (reload)
import 'dotenv/config'
import app from './app.ts'
import { env } from '@/config/env.ts'
import { connectDatabase, disconnectDatabase } from '@/config/database.ts'
import { logger } from '@/utils/logger.ts'
import { startReminderJobs } from '@/jobs/reminders.job.ts'
import { TabbyService } from '@/services/tabby.service.ts'
import { seedDefaultRoles } from '@/utils/seedRoles.ts'
import { seedOrganizations } from '@/utils/seedOrganizations.ts'
import { UserModel, OrganizationModel, CourseModel, LiveClassModel, EnrollmentModel, OrderModel, CouponModel, SupportTicketModel } from '@/models/schema.ts'

async function bootstrap() {
  /* 1. Connect to MongoDB before accepting traffic */
  await connectDatabase()

  /* 1a. Ensure system roles exist (idempotent — skips existing) */
  await seedDefaultRoles()

  /* 1a-org. Ensure both academy organizations exist (idempotent) */
  await seedOrganizations()

  /* 1b-pre. Drop the old sparse unique index on stripeCheckoutSessionId so
     Razorpay orders (which have no Stripe session) can coexist in the collection.
     The schema now uses a partialFilterExpression instead. Idempotent — safe to run
     every boot; throws are swallowed if the index doesn't exist. */
  try {
    const { OrderModel } = await import('@/models/schema.ts')
    await OrderModel.collection.dropIndex('stripeCheckoutSessionId_1')
    await OrderModel.syncIndexes()
    logger.info('✅  Re-indexed orders: stripeCheckoutSessionId partial index applied')
  } catch {
    // Index already gone or collection doesn't exist yet — no action needed
  }

  /* 1b-pre2. Drop the legacy globally-unique index on coupon.code. Coupon codes
     are unique PER ORGANIZATION now (compound index in the schema), so the old
     single-field unique index would still reject a second academy reusing a
     code. Idempotent — swallowed when the index is already gone. */
  try {
    const { CouponModel } = await import('@/models/schema.ts')
    await CouponModel.collection.dropIndex('code_1')
    await CouponModel.syncIndexes()
    logger.info('✅  Re-indexed coupons: code is now unique per organization')
  } catch {
    // Index already dropped or collection doesn't exist yet — no action needed
  }

  /* 1b. Migrate legacy student accounts that predate the enrollmentStatus field */
  const migrated = await UserModel.updateMany(
    { role: 'student', enrollmentStatus: { $exists: false } },
    { $set: { enrollmentStatus: 'approved' } },
  )
  if (migrated.modifiedCount > 0) {
    logger.info(`✅  Migrated ${migrated.modifiedCount} legacy student(s) → enrollmentStatus: approved`)
  }

  /* 1c. Org backfill — assign all records that predate organizationId to Dubai Academy.
     This runs once per record (idempotent: only touches docs without organizationId). */
  const dubaiOrg = await OrganizationModel.findOne({ slug: 'dubai' })
  if (dubaiOrg) {
    const orgId  = dubaiOrg._id
    const noOrg  = { organizationId: { $exists: false } }
    const setOrg = { $set: { organizationId: orgId } }

    /* LearningPathModel joined this list with P-22, which gave learning paths
       an organizationId. Rows created before that have none, and the
       `{org} OR {null}` filters keep them visible either way — this just
       stops them lingering as permanently unscoped. */
    const { LearningPathModel } = await import('@/models/schema.ts')

    const [users, courses, classes, enrollments, orders, coupons, tickets, paths] = await Promise.all([
      UserModel.updateMany({ ...noOrg, role: { $ne: 'super_admin' } }, setOrg),
      CourseModel.updateMany(noOrg, setOrg),
      LiveClassModel.updateMany(noOrg, setOrg),
      EnrollmentModel.updateMany(noOrg, setOrg),
      OrderModel.updateMany(noOrg, setOrg),
      CouponModel.updateMany(noOrg, setOrg),
      SupportTicketModel.updateMany(noOrg, setOrg),
      LearningPathModel.updateMany(noOrg, setOrg),
    ])

    const total = users.modifiedCount + courses.modifiedCount + classes.modifiedCount
      + enrollments.modifiedCount + orders.modifiedCount + coupons.modifiedCount
      + tickets.modifiedCount + paths.modifiedCount

    if (total > 0) {
      logger.info(`✅  Org backfill: assigned ${total} record(s) → Dubai Academy`)
    }
  }

  /* 1d. Coupon currency backfill (N-01) — stamp each coupon with its academy's
     currency so a fixed-amount discount has a defined unit.

     `discountValue` used to be documented as USD but applied as bare minor
     units against whatever the gateway charged in, so one "50" coupon meant
     50 AED through Abzer and 50 INR through Razorpay. Redemption now requires
     the currencies to match, and a fixed coupon with no currency on record is
     refused outright — so this backfill is what keeps existing coupons usable.

     Idempotent: only touches rows that have no currency yet. Percent coupons
     are stamped too (harmless, and it keeps the field uniform) — a ratio is
     currency-neutral so their behaviour is unchanged either way. */
  const orgs = await OrganizationModel.find().select('_id currency').lean()
  let stamped = 0
  for (const org of orgs) {
    if (!org.currency) continue
    const res = await CouponModel.updateMany(
      { organizationId: org._id, currency: { $exists: false } },
      { $set: { currency: org.currency } },
    )
    stamped += res.modifiedCount
  }
  if (stamped > 0) {
    logger.info(`✅  Coupon currency backfill: stamped ${stamped} coupon(s) from their academy`)
  }
  /* Anything still unstamped has no resolvable academy — surface it, because
     every fixed coupon in this state will be refused at checkout. */
  /* 1e. Verification-first signup (M-05).
     This used to log an error on every boot: the flag issues no session at
     signup, and the full signup form uploaded its identity documents AFTER
     registering using exactly that session, so turning it on silently lost
     every applicant's passport and ID.

     That blocker is gone — the documents now go up before registration via
     POST /uploads/signup-doc and travel in with the register payload, so a
     signup completes without a session on either side. What remains is a
     product trade-off rather than a defect, so this is informational. */
  if (process.env['SIGNUP_REQUIRE_VERIFICATION'] === 'true') {
    logger.info(
      'ℹ️  SIGNUP_REQUIRE_VERIFICATION is ON — new accounts get no session until the ' +
      'emailed link is followed. Identity documents are stored before registration, so ' +
      'full signups complete normally. Deliverability now gates first sign-in.',
    )
  }

  const orphaned = await CouponModel.countDocuments({
    currency: { $exists: false }, discountType: 'fixed',
  })
  if (orphaned > 0) {
    logger.error(
      { orphaned },
      '⚠️  Fixed-amount coupons with no currency on record — these will be REFUSED at checkout until re-created (N-01)',
    )
  }

  /* 2. Start HTTP server.
     Under PM2 multi-instance load balancing, every fork inherits the SAME
     env PORT (base), so we derive a unique listen port per instance from
     NODE_APP_INSTANCE (0,1,2,…). This is deterministic and does NOT rely on
     PM2's `increment_var`, which is unreliable in fork mode.
       instance 0 → base+0 (4000), instance 1 → 4001, … matching nginx upstream.
     Single process / dev: NODE_APP_INSTANCE is unset → 0 → listens on base. */
  const instanceId = Number(process.env.NODE_APP_INSTANCE ?? 0)
  const listenPort = env.PORT + instanceId
  process.env.PORT = String(listenPort) // so /health reports the real port
  /* Bind loopback only — nginx dials 127.0.0.1:4000-4003 (see nginx.lms.conf),
     so a public bind would let anyone reach the API directly and skip TLS, the
     WAF and the edge rate limits. Set BIND_HOST=0.0.0.0 when the proxy lives in
     a different container/host and loopback is not reachable. */
  const bindHost = process.env.BIND_HOST ?? '127.0.0.1'
  const server = app.listen(listenPort, bindHost, () => {
    logger.info(`🚀  Server running on http://${bindHost}:${listenPort} (instance ${instanceId})`)
    logger.info(`📡  API prefix: /api/v1`)
    logger.info(`🌍  Environment: ${env.NODE_ENV}`)
  })

  /* 3. Start cron jobs — ONLY on the primary instance.
     Under PM2 multi-instance load balancing, PM2 sets NODE_APP_INSTANCE
     (0,1,2,…) per fork. Running the scheduler on every instance would fire
     each reminder N times, so we pin it to instance 0. When unset (single
     process / dev), it defaults to '0' and jobs run normally. */
  if ((process.env.NODE_APP_INSTANCE ?? '0') === '0') {
    startReminderJobs()
    logger.info('⏰  Reminder cron jobs started (primary instance)')
  } else {
    logger.info(`⏸️   Reminder cron jobs skipped (instance ${process.env.NODE_APP_INSTANCE})`)
  }

  /* H-11 — identity scans must live in storage with no public access.
     pub-*.r2.dev exposes an entire bucket, so the main media bucket cannot
     hold them. Loud on every boot until a private bucket is configured. */
  {
    const { isKycStoragePrivate, isR2Configured } = await import('@/services/r2.service.ts')
    if (!isKycStoragePrivate()) {
      logger.error(
        'R2_KYC_BUCKET_NAME is not set to a separate PRIVATE bucket — passport and ID scans remain publicly readable (H-11).',
      )
    } else if (isR2Configured()) {
      logger.info('🔐  Identity scans stored in a private bucket')
    }
  }

  /* Register Tabby webhook (idempotent — safe to call every boot) */
  void new TabbyService().registerWebhook()

  /* 4. Graceful shutdown */
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`)
    server.close(async () => {
      await disconnectDatabase()
      logger.info('HTTP server closed')
      process.exit(0)
    })
    /* Force exit after 10s if connections hang */
    setTimeout(() => {
      logger.error('Forced shutdown after timeout')
      process.exit(1)
    }, 10_000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))

  /* 5. Unhandled rejections */
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection')
    // Don't exit — log and continue in prod
  })

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting')
    process.exit(1)
  })
}

bootstrap()
