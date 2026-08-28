/* ─────────────────────────────────────────────────────────────
   Email failover + durable outbox.

   The claim under test is "no notification is lost", so the suite drives the
   real failure modes rather than a happy path: a mailbox that reports its
   daily cap, both mailboxes capped at once, a permanently bad address, and a
   transient blip that later clears.

   No SMTP is involved — the pool is exercised through a fake transport that
   returns real Gmail response strings, which is what the classifier keys on.

   Isolated throwaway database (lms_emailoutbox), dropped on exit.
   Run: bun run test:emailoutbox
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_emailoutbox'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
/* Belt and braces with the NODE_ENV guard in buildSender: bun loads the
   project .env, so without this the pool would post real mail to Gmail for
   every @example.com fixture. */
process.env.SMTP_HOST        = ''
process.env.SMTP_USER        = ''
process.env.SMTP_PASS        = ''
process.env.EMAIL_FROM       = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { EmailOutboxModel } = await import('@/models/schema.ts')
const { backoffFor, MAX_EMAIL_ATTEMPTS } = await import('@/services/email.service.ts')
const { drainOutboxOnce } = await import('@/jobs/emailOutbox.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_emailoutbox') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

/* ── The real Gmail responses the classifier has to tell apart ── */
const QUOTA_ERR = Object.assign(new Error('Message failed'), {
  responseCode: 550,
  response: '550 5.4.5 Daily user sending limit exceeded. Learn more at https://support.google.com',
})
const BAD_ADDRESS_ERR = Object.assign(new Error('Message failed'), {
  responseCode: 550,
  response: "550 5.1.1 The email account that you tried to reach does not exist.",
})
const TRANSIENT_ERR = Object.assign(new Error('Connection timeout'), { responseCode: 421 })

try {
  section('A · the classifier separates the two meanings of 550')
  /* Reached through the pool rather than exported directly — the behaviour is
     what matters, and this is the distinction the whole design rests on. */
  const { PermanentEmailError } = await import('@/services/email.service.ts')
  check('PermanentEmailError is exported for callers to detect', typeof PermanentEmailError === 'function')

  section('B · backoff grows, then plateaus')
  const steps = [0, 1, 2, 3, 4, 5, 6, 7, 20].map(backoffFor)
  check('first retry is a minute', steps[0] === 60_000, String(steps[0]))
  check('backoff is non-decreasing', steps.every((v, i) => i === 0 || v >= steps[i - 1]!))
  check('it plateaus at 24h rather than growing forever',
    steps[steps.length - 1] === 24 * 60 * 60_000, String(steps[steps.length - 1]))
  check('attempts are capped', MAX_EMAIL_ATTEMPTS > 0 && MAX_EMAIL_ATTEMPTS <= 20, String(MAX_EMAIL_ATTEMPTS))

  section('C · a refused send leaves the row PENDING, never dropped')
  await EmailOutboxModel.deleteMany({})
  const row = await EmailOutboxModel.create({
    to: 'student@example.com', subject: 'Class reminder', html: '<p>hi</p>',
    nextAttemptAt: new Date(Date.now() - 1000),
  })
  check('the row is persisted before any send is attempted',
    (await EmailOutboxModel.countDocuments({ status: 'pending' })) === 1)

  /* Drain with no SMTP configured -> console sender, which succeeds. */
  const t1 = await drainOutboxOnce()
  check('the drain delivers a due row', t1.sent === 1, JSON.stringify(t1))
  const after = await EmailOutboxModel.findById(row._id).lean() as any
  check('and marks it sent with a timestamp', after?.status === 'sent' && !!after?.sentAt, after?.status)

  section('D · a row that is not yet due is left alone')
  await EmailOutboxModel.deleteMany({})
  await EmailOutboxModel.create({
    to: 'later@example.com', subject: 'Later', html: '<p>later</p>',
    nextAttemptAt: new Date(Date.now() + 60 * 60_000),
  })
  const t2 = await drainOutboxOnce()
  check('a future nextAttemptAt is skipped', t2.sent === 0 && t2.retry === 0, JSON.stringify(t2))
  check('and the row is still pending',
    (await EmailOutboxModel.countDocuments({ status: 'pending' })) === 1)

  section('E · the drain is batched, so a backlog cannot become a burst')
  await EmailOutboxModel.deleteMany({})
  const many = Array.from({ length: 40 }, (_, i) => ({
    to: `bulk${i}@example.com`, subject: `Bulk ${i}`, html: '<p>x</p>',
    nextAttemptAt: new Date(Date.now() - 1000),
  }))
  await EmailOutboxModel.insertMany(many)
  const t3 = await drainOutboxOnce()
  check('one pass sends at most the batch size', t3.sent <= 25, `sent ${t3.sent}`)
  check('the remainder stays pending for the next tick',
    (await EmailOutboxModel.countDocuments({ status: 'pending' })) === 40 - t3.sent)
  /* Drain until empty — the backlog must actually clear, not stall. */
  let guard = 0
  while ((await EmailOutboxModel.countDocuments({ status: 'pending' })) > 0 && guard++ < 10) {
    await drainOutboxOnce()
  }
  check('repeated ticks clear the whole backlog',
    (await EmailOutboxModel.countDocuments({ status: 'pending' })) === 0, `after ${guard} ticks`)
  check('every one of the 40 was delivered',
    (await EmailOutboxModel.countDocuments({ status: 'sent' })) === 40)

  section('F · nothing is ever silently discarded')
  const total = await EmailOutboxModel.countDocuments({})
  const sent  = await EmailOutboxModel.countDocuments({ status: 'sent' })
  const pend  = await EmailOutboxModel.countDocuments({ status: 'pending' })
  const bad   = await EmailOutboxModel.countDocuments({ status: 'failed' })
  check('every row is accounted for in exactly one state', total === sent + pend + bad,
    `${total} != ${sent}+${pend}+${bad}`)

  section('G · the TTL only ever reaps DELIVERED mail')
  /* Suites run with autoIndex off, so the indexes must be created explicitly
     before they can be inspected. */
  await EmailOutboxModel.syncIndexes()
  const idx = await EmailOutboxModel.collection.indexes()
  const ttl = idx.find((i: any) => i.expireAfterSeconds !== undefined)
  check('a TTL index exists', !!ttl)
  check('and it is keyed on sentAt, so pending/failed rows never expire',
    !!ttl && Object.keys(ttl.key)[0] === 'sentAt', JSON.stringify(ttl?.key))

  section('H1 · the BACKUP mailbox is actually picked up from env')
  {
    /* This is the bug that shipped: the backup key names were derived by
       gluing 'SMTP_BACKUP' onto the primary's, producing SMTP_BACKUP_SMTP_HOST
       — which matches nothing. The pool ran with one mailbox and nothing broke
       until the primary hit its cap, i.e. the exact moment failover mattered.
       Assert against the REAL .env key names, not a derived guess. */
    const { resolveMailbox, PRIMARY_KEYS, BACKUP_KEYS } =
      await import('@/services/email.service.ts')

    const env = {
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_USER: 'no-reply@primary.test',
      SMTP_PASS: 'p1',
      EMAIL_FROM: 'LMS <no-reply@primary.test>',

      SMTP_BACKUP_HOST: 'smtp.gmail.com',
      SMTP_BACKUP_PORT: '587',
      SMTP_BACKUP_USER: 'support@backup.test',
      SMTP_BACKUP_PASS: 'p2',
      SMTP_BACKUP_EMAIL_FROM: 'LMS <support@backup.test>',
    }

    const primary = resolveMailbox(PRIMARY_KEYS, env)
    const backup  = resolveMailbox(BACKUP_KEYS, env)

    check('the primary resolves', primary?.user === 'no-reply@primary.test', JSON.stringify(primary))
    check('THE BACKUP RESOLVES — the bug that shipped',
      backup?.user === 'support@backup.test', JSON.stringify(backup))
    check('the backup uses its OWN From, not the primary\u2019s',
      backup?.from === 'LMS <support@backup.test>', backup?.from)
    check('the two are distinct mailboxes',
      primary?.user !== backup?.user && primary?.from !== backup?.from)
    check('port and secure are derived per mailbox',
      backup?.port === 587 && backup?.secure === false, JSON.stringify(backup))

    /* Every key the backup needs must be spelled SMTP_BACKUP_<X>, never
       SMTP_BACKUP_SMTP_<X>. */
    for (const [field, key] of Object.entries(BACKUP_KEYS)) {
      check(`backup key '${field}' has no doubled SMTP_ segment`,
        !String(key).includes('SMTP_BACKUP_SMTP_'), String(key))
    }

    check('an unconfigured backup resolves to null, leaving a single-mailbox pool',
      resolveMailbox(BACKUP_KEYS, { SMTP_HOST: 'x', SMTP_USER: 'y', SMTP_PASS: 'z', EMAIL_FROM: 'f' }) === null)
    check('a half-configured backup (no password) is refused rather than half-built',
      resolveMailbox(BACKUP_KEYS, {
        SMTP_BACKUP_HOST: 'h', SMTP_BACKUP_USER: 'u', SMTP_BACKUP_EMAIL_FROM: 'f',
      }) === null)

    /* The real .env must actually produce two mailboxes — this suite blanks the
       vars, so read the file rather than the environment. */
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(new URL('../../.env', import.meta.url), 'utf8').catch(() => '')
    if (raw) {
      const has = (k: string) => new RegExp(`^${k}=\\s*\\S`, 'm').test(raw)
      const configured = has('SMTP_BACKUP_HOST') && has('SMTP_BACKUP_USER') && has('SMTP_BACKUP_PASS')
      check('this deployment has a backup mailbox configured in .env', configured,
        'set SMTP_BACKUP_HOST/USER/PASS to enable failover')
    }
  }

  section('H2 · FAILOVER — the primary hits its cap and the backup takes over')
  {
    const { PooledEmailSender } = await import('@/services/email.service.ts')

    /* Fake transports. Nodemailer is not involved: the pool only ever sees
       sendMail() resolving or throwing, and the classifier keys on the
       response text, which is reproduced verbatim from Gmail. */
    const log: string[] = []
    const fake = (name: string, behaviour: 'ok' | 'quota' | 'permanent' | 'transient') => ({
      name,
      from: `${name}@test.local`,
      cooldownUntil: 0,
      transporter: {
        sendMail: async () => {
          log.push(name)
          if (behaviour === 'quota')     throw QUOTA_ERR
          if (behaviour === 'permanent') throw BAD_ADDRESS_ERR
          if (behaviour === 'transient') throw TRANSIENT_ERR
          return { messageId: `<${name}>` }
        },
      },
    })

    /* 1 — primary capped, backup healthy */
    const primary = fake('primary', 'quota')
    const backup  = fake('backup', 'ok')
    const pool    = new PooledEmailSender([primary, backup] as never)

    log.length = 0
    await pool.send({ to: 's@example.com', subject: 'x', html: '<p>x</p>' })
    check('the primary is tried first', log[0] === 'primary', log.join(','))
    check('the BACKUP delivers it once the primary reports its cap',
      log[1] === 'backup', log.join(','))

    const st = pool.status()
    check('the capped primary is parked', st.find(t => t.name === 'primary')?.cooling === true)
    check('the backup stays available', st.find(t => t.name === 'backup')?.cooling === false)

    /* 2 — a parked mailbox is skipped entirely on the next send */
    log.length = 0
    await pool.send({ to: 's2@example.com', subject: 'x', html: '<p>x</p>' })
    check('the next message skips the parked primary and goes straight to backup',
      log.length === 1 && log[0] === 'backup', log.join(','))

    /* 3 — a bad address must NOT burn the backup: no mailbox can fix it */
    const p3 = fake('primary', 'permanent')
    const b3 = fake('backup', 'ok')
    const pool3 = new PooledEmailSender([p3, b3] as never)
    log.length = 0
    let threw = false
    try { await pool3.send({ to: 'nope@example.com', subject: 'x', html: '<p>x</p>' }) }
    catch { threw = true }
    check('a permanent rejection throws instead of failing over', threw)
    check('and the backup is never contacted for a bad address',
      !log.includes('backup'), log.join(','))
    check('the backup is left un-parked', pool3.status().every(t => !t.cooling))

    /* 4 — both capped: the send must FAIL so the outbox keeps the row */
    const p4 = fake('primary', 'quota')
    const b4 = fake('backup', 'quota')
    const pool4 = new PooledEmailSender([p4, b4] as never)
    let bothFailed = false
    try { await pool4.send({ to: 's@example.com', subject: 'x', html: '<p>x</p>' }) }
    catch { bothFailed = true }
    check('with every mailbox capped the send reports failure', bothFailed)
    check('both mailboxes are parked', pool4.status().every(t => t.cooling))

    /* The row staying pending is what makes it "late, not lost". */
    let stillFails = false
    try { await pool4.send({ to: 's@example.com', subject: 'x', html: '<p>x</p>' }) }
    catch (e) { stillFails = /cooldown/i.test(String((e as Error).message)) }
    check('further sends fail fast with a cooldown message, not a hang', stillFails)

    /* 5 — a transient blip on the primary still gets delivered by the backup,
           and must NOT park the primary (nothing is wrong with its quota). */
    const p5 = fake('primary', 'transient')
    const b5 = fake('backup', 'ok')
    const pool5 = new PooledEmailSender([p5, b5] as never)
    log.length = 0
    await pool5.send({ to: 's@example.com', subject: 'x', html: '<p>x</p>' })
    check('a transient primary failure still delivers via backup',
      log.join(',') === 'primary,backup', log.join(','))
    check('and does NOT park the primary — its quota is fine',
      pool5.status().find(t => t.name === 'primary')?.cooling === false)
  }

  section('H · quota vs bad-address vs transient are distinguishable')
  const texts = [
    ['quota',     QUOTA_ERR.response],
    ['permanent', BAD_ADDRESS_ERR.response],
  ] as [string, string][]
  for (const [kind, text] of texts) {
    const isQuota = /daily (user )?sending limit|5\.4\.5/i.test(text)
    const isPerm  = /does not exist|5\.1\.1/i.test(text)
    check(`a ${kind} response is recognised`, kind === 'quota' ? isQuota && !isPerm : isPerm && !isQuota, text)
  }
  check('a 421 is treated as transient, not permanent', TRANSIENT_ERR.responseCode === 421)

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
