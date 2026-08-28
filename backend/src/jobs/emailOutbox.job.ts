/* ─────────────────────────────────────────────────────
   Email outbox drain
   ─────────────────────────────────────────────────────
   Replays anything the immediate send could not deliver: a mailbox that hit
   its daily cap, an SMTP blip, a redeploy mid-send. Rows stay `pending` with a
   backoff, and this sweeps them until they go out.

   This is the half of the design that makes "no notification is lost" true.
   The mailbox pool only raises the ceiling — without a queue, exceeding the
   combined limit would still drop mail on the floor.

   Runs on the primary PM2 instance only (see index.ts), like the reminder
   jobs: N instances draining the same rows would send duplicates.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { EmailOutboxModel } from '@/models/schema.ts'
import { deliverOutboxRow } from '@/services/email.service.ts'
import { logger } from '@/utils/logger.ts'

/* Small enough that a backlog cannot itself become a send burst — 2,000/day is
   ~83/hour, so 25 a minute is far more headroom than the mailboxes have. */
const BATCH = Number(process.env['EMAIL_OUTBOX_BATCH'] ?? 25)

let running = false

export async function drainOutboxOnce(): Promise<{ sent: number; retry: number; failed: number }> {
  const tally = { sent: 0, retry: 0, failed: 0 }

  const due = await EmailOutboxModel
    .find({ status: 'pending', nextAttemptAt: { $lte: new Date() } })
    .sort({ nextAttemptAt: 1 })
    .limit(BATCH)
    .lean()

  for (const row of due as unknown as {
    _id: unknown; to: string; subject: string; html: string; text?: string; attempts: number
  }[]) {
    const outcome = await deliverOutboxRow({
      id: String(row._id), to: row.to, subject: row.subject,
      html: row.html, text: row.text, attempts: row.attempts ?? 0,
    })
    tally[outcome === 'sent' ? 'sent' : outcome === 'failed' ? 'failed' : 'retry']++
  }

  return tally
}

export function startEmailOutboxJob(): void {
  /* Every minute. The work is idempotent per row and capped by BATCH, so a
     slow SMTP round does not stack up — `running` skips an overlapping tick. */
  cron.schedule('* * * * *', () => {
    if (running) return
    running = true
    void drainOutboxOnce()
      .then(t => {
        if (t.sent || t.failed) logger.info(t, 'email outbox drained')
        else if (t.retry)       logger.debug(t, 'email outbox — all deferred')
      })
      .catch(err => logger.error({ err }, 'email outbox drain failed'))
      .finally(() => { running = false })
  })

  /* A backlog that is not moving means both mailboxes are capped, or something
     is wrong that retries will not fix. Worth saying out loud once an hour
     rather than leaving it in a collection nobody reads. */
  cron.schedule('0 * * * *', () => {
    void (async () => {
      const [pending, failed] = await Promise.all([
        EmailOutboxModel.countDocuments({ status: 'pending' }),
        EmailOutboxModel.countDocuments({ status: 'failed' }),
      ])
      if (pending > 50 || failed > 0) {
        logger.warn({ pending, failed }, 'email outbox backlog — check mailbox quotas')
      }
    })().catch(err => logger.error({ err }, 'email outbox health check failed'))
  })

  logger.info({ batch: BATCH }, 'Email outbox drain started (every minute)')
}
