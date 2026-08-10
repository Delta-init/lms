import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { OrderService } from '@/services/order.service.ts'
import { StripeService } from '@/services/stripe.service.ts'
import { RazorpayService } from '@/services/razorpay.service.ts'
import { AbzerService } from '@/services/abzer.service.ts'
import { TamaraService } from '@/services/tamara.service.ts'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'
import type { Request, Response } from 'express'

/* ─────────────────────────────────────────────────────
   Stripe webhook router
   ─────────────────────────────────────────────────────
   IMPORTANT: this route uses express.raw() so the body
   arrives as a Buffer. It is mounted in app.ts BEFORE
   the global express.json() so the stream isn't lost.
   We never throw from here — always respond 200 so
   Stripe doesn't retry on programming errors. Critical
   fulfillment failures are logged for manual recovery.
───────────────────────────────────────────────────── */

const router      = Router()
const orderSvc    = new OrderService()
const stripeSvc   = new StripeService()
const razorpaySvc = new RazorpayService()
const abzerSvc    = new AbzerService()
const tamaraSvc   = new TamaraService()

/* ─────────────────────────────────────────────────────
   Untrusted-payload helpers
   ─────────────────────────────────────────────────────
   asString() rejects anything that is not a primitive
   string. Webhook bodies are attacker-controllable JSON,
   so an identifier like {"$gt":""} would otherwise reach
   Mongo as a real query operator and match an unrelated
   order. We reject rather than String()-coerce so an
   object never becomes the literal "[object Object]".
   safeEqual() compares shared secrets in constant time.
───────────────────────────────────────────────────── */
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const safeEqual = (received: unknown, expected: string): boolean => {
  if (typeof received !== 'string') return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false          /* timingSafeEqual throws on length mismatch */
  return timingSafeEqual(a, b)
}

/* ─────────────────────────────────────────────────────
   requireWebhookSecret  (C-01)
   ─────────────────────────────────────────────────────
   Every gateway handler below verifies its callback only
   when its secret happens to be configured. On its own
   that means a blank secret silently downgrades the
   endpoint to an unauthenticated fulfilment API — anyone
   who knows an order id can forge `paid` and collect the
   enrolment plus the auto-approval that follows.

   This guard makes a missing secret fatal in a deployed
   environment, mirroring the Stripe handler's backstop
   below and mux.service.ts, which returns false outright
   when its secret is absent. Non-production keeps the
   skip-with-a-warning behaviour so local gateway testing
   works without secrets.

   Returns false and responds when the caller must stop.
   400 (not 200) is deliberate: gateways retry on 4xx and
   surface the failure in their dashboard, so a
   misconfigured deployment is loud rather than silent.
───────────────────────────────────────────────────── */
function requireWebhookSecret(
  res:     Response,
  secret:  string | undefined,
  gateway: string,
  envVar:  string,
): boolean {
  if (secret) return true

  if (env.NODE_ENV === 'production') {
    logger.error(
      { gateway },
      `${gateway} webhook: ${envVar} is not configured — rejecting unverified callback`,
    )
    res.status(400).json({ error: 'Webhook secret not configured' })
    return false
  }

  logger.warn(`${gateway} webhook: no ${envVar} — skipping signature verification (dev only)`)
  return true
}

router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature']

  /* ── Guard: no Stripe key configured ────────────── */
  if (!env.STRIPE_SECRET_KEY) {
    logger.warn('Stripe webhook received but STRIPE_SECRET_KEY is not configured')
    res.status(200).json({ received: true })
    return
  }

  let event: import('stripe').Stripe.Event

  /* ── Verify signature ────────────────────────────── */
  try {
    if (env.STRIPE_WEBHOOK_SECRET) {
      /* Production: always verify */
      const rawBody = req.body as Buffer
      if (!Buffer.isBuffer(rawBody)) {
        logger.error('Webhook: body is not a Buffer — ensure express.raw() is applied before express.json()')
        res.status(400).json({ error: 'Invalid body format' })
        return
      }
      event = stripeSvc.constructWebhookEvent(rawBody, String(sig), env.STRIPE_WEBHOOK_SECRET)
    } else {
      /* Dev without STRIPE_WEBHOOK_SECRET: parse body directly */
      if (env.NODE_ENV === 'production') {
        logger.error('Webhook: STRIPE_WEBHOOK_SECRET required in production')
        res.status(400).json({ error: 'Webhook secret not configured' })
        return
      }
      logger.warn('Webhook: no STRIPE_WEBHOOK_SECRET — skipping signature verification (dev only)')
      event = typeof req.body === 'string'
        ? JSON.parse(req.body)
        : (req.body as import('stripe').Stripe.Event)
    }
  } catch (err) {
    logger.warn({ err }, 'Webhook signature verification failed')
    res.status(400).json({ error: 'Webhook signature verification failed' })
    return
  }

  /* ── Handle events ───────────────────────────────── */
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as import('stripe').Stripe.Checkout.Session
        if (session.payment_status === 'paid') {
          const sessionId       = asString(session.id)
          const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : asString(session.payment_intent?.id) ?? ''
          if (!sessionId) {
            logger.warn('Webhook: checkout session id is not a string — ignoring event')
            break
          }
          await orderSvc.fulfillOrder(sessionId, paymentIntentId)
          logger.info({ sessionId }, 'Order fulfilled via webhook')
        }
        break
      }
      /* Add other event types here as needed */
      default:
        logger.debug({ type: event.type }, 'Unhandled Stripe event type')
    }
  } catch (err) {
    /* Log but don't throw — Stripe should not retry on business-logic errors */
    logger.error({ err, eventType: event.type }, 'Webhook handler error')
  }

  res.status(200).json({ received: true })
})

/* ─────────────────────────────────────────────────────
   Razorpay webhook
   ─────────────────────────────────────────────────────
   Backup fulfillment path — in case the user closes the
   browser before /verify completes. Always returns 200.
───────────────────────────────────────────────────── */
router.post('/razorpay', async (req: Request, res: Response) => {
  if (!requireWebhookSecret(res, env.RAZORPAY_WEBHOOK_SECRET, 'Razorpay', 'RAZORPAY_WEBHOOK_SECRET')) return

  /* Verify X-Razorpay-Signature when webhook secret is configured */
  if (env.RAZORPAY_WEBHOOK_SECRET) {
    const sig     = req.headers['x-razorpay-signature'] as string | undefined
    const rawBody = req.body as Buffer
    if (!sig || !Buffer.isBuffer(rawBody)) {
      logger.warn('Razorpay webhook: missing signature or body')
      res.status(200).json({ received: true })
      return
    }
    const valid = razorpaySvc.verifyWebhookSignature(rawBody.toString(), sig, env.RAZORPAY_WEBHOOK_SECRET)
    if (!valid) {
      logger.warn('Razorpay webhook: signature mismatch')
      res.status(200).json({ received: true })
      return
    }
  }

  let payload: any
  try {
    const raw = req.body
    payload = Buffer.isBuffer(raw)
      ? JSON.parse(raw.toString('utf8'))
      : typeof raw === 'string'
        ? JSON.parse(raw)
        : raw
  } catch {
    res.status(200).json({ received: true })
    return
  }

  try {
    if (payload?.event === 'payment.captured') {
      const payment       = payload.payload?.payment?.entity
      const razorpayOrderId   = asString(payment?.order_id)
      const razorpayPaymentId = asString(payment?.id)
      if (razorpayOrderId && razorpayPaymentId) {
        await orderSvc.fulfillFromWebhook(razorpayOrderId, razorpayPaymentId)
        logger.info({ razorpayOrderId }, 'Razorpay order fulfilled via webhook')
      }
    }
  } catch (err) {
    logger.error({ err, event: payload?.event }, 'Razorpay webhook handler error')
  }

  res.status(200).json({ received: true })
})

/* ─────────────────────────────────────────────────────
   Tabby webhook
   Tabby calls this when a payment is AUTHORIZED/CLOSED.
   Security: Tabby sends the static Authorization header
   registered with the webhook (if TABBY_WEBHOOK_SECRET set).
   The fulfillment itself calls getPayment() server-to-server
   to verify status before capturing — defence in depth.
   Always responds 200 so Tabby doesn't retry on errors.
───────────────────────────────────────────────────── */
router.post('/tabby', async (req: Request, res: Response) => {
  if (!requireWebhookSecret(res, env.TABBY_WEBHOOK_SECRET, 'Tabby', 'TABBY_WEBHOOK_SECRET')) return

  /* Verify static Authorization header when secret is configured.
     Register the webhook with: auth_header.value = "Bearer <TABBY_WEBHOOK_SECRET>" */
  if (env.TABBY_WEBHOOK_SECRET) {
    const authHeader = req.headers['authorization']
    if (!safeEqual(authHeader, `Bearer ${env.TABBY_WEBHOOK_SECRET}`)) {
      logger.warn('Tabby webhook: invalid or missing authorization header')
      res.status(200).json({ received: true })
      return
    }
  }

  let payload: any
  try {
    const raw = req.body
    payload = Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : (typeof raw === 'string' ? JSON.parse(raw) : raw)
  } catch {
    res.status(200).json({ received: true })
    return
  }

  try {
    /* Tabby sends payment status as lowercase "authorized" or "closed" */
    const status     = asString(payload?.status)?.toUpperCase()
    const paymentId  = asString(payload?.id)
    /* order.reference_id is our LMS order ID (set in checkout request) */
    const ourOrderId = asString(payload?.order?.reference_id)

    if ((status === 'AUTHORIZED' || status === 'CLOSED') && paymentId) {
      await orderSvc.fulfillTabbyFromWebhook(paymentId, ourOrderId)
      logger.info({ paymentId, ourOrderId }, 'Tabby: order fulfilled via webhook')
    } else {
      logger.debug({ status, paymentId }, 'Tabby webhook: ignored event')
    }
  } catch (err) {
    logger.error({ err, payload }, 'Tabby webhook handler error')
  }

  res.status(200).json({ received: true })
})

/* ─────────────────────────────────────────────────────
   Abzer (BillXPro) webhook
   Event: WH_RECEIPT_POSTING — triggered on successful payment
   Security: Abzer sends a custom header you configure in
   their admin console. Set X-Abzer-Secret to ABZER_WEBHOOK_SECRET.
   Always responds 200 so Abzer doesn't retry on errors.
───────────────────────────────────────────────────── */
router.post('/abzer', async (req: Request, res: Response) => {
  if (!requireWebhookSecret(res, env.ABZER_WEBHOOK_SECRET, 'Abzer', 'ABZER_WEBHOOK_SECRET')) return

  /* Verify custom secret header when configured */
  if (env.ABZER_WEBHOOK_SECRET) {
    /* Configure Abzer admin → Webhook → Headers → X-Abzer-Secret: <your secret> */
    const headerSecret = req.headers['x-abzer-secret'] ?? req.headers['x-apikey']
    if (!safeEqual(headerSecret, env.ABZER_WEBHOOK_SECRET)) {
      logger.warn('Abzer webhook: invalid or missing secret header')
      res.status(200).json({ received: true })
      return
    }
  }

  let payload: any
  try {
    const raw = req.body
    payload = Buffer.isBuffer(raw)
      ? JSON.parse(raw.toString('utf8'))
      : typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    res.status(200).json({ received: true })
    return
  }

  try {
    /*
     * WH_RECEIPT_POSTING payload fields (Abzer Webhook Docs v1.0):
     *   type:          'WH_RECEIPT_POSTING'
     *   paymentStatus: 'Success' | 'Pending Approval'
     *   receiptId:     Abzer's receipt UUID
     *   invoiceNumber: our referenceNumber (= our orderId)
     */
    const type          = asString(payload?.type)
    const paymentStatus = asString(payload?.paymentStatus)
    const orderId       = asString(payload?.invoiceNumber)   /* our referenceNumber */
    const receiptId     = asString(payload?.receiptId)

    if (type === 'WH_RECEIPT_POSTING' && paymentStatus === 'Success' && orderId && receiptId) {
      await orderSvc.fulfillAbzerFromWebhook(orderId, receiptId)
    } else {
      logger.debug({ type, paymentStatus, orderId }, 'Abzer webhook: ignored event')
    }
  } catch (err) {
    logger.error({ err, payload }, 'Abzer webhook handler error')
  }

  res.status(200).json({ received: true })
})

/* ─────────────────────────────────────────────────────
   Tamara webhook
   Tamara fires ORDER_APPROVED when the customer completes
   the BNPL agreement. Tamara authenticates by attaching a
   JWT (HS256, signed with TAMARA_NOTIFICATION_TOKEN) as:
     Authorization: Bearer <tamaraToken>
     ?tamaraToken=<tamaraToken>
   Always responds 200 so Tamara doesn't retry on errors.
───────────────────────────────────────────────────── */
router.post('/tamara', async (req: Request, res: Response) => {
  if (!requireWebhookSecret(res, env.TAMARA_NOTIFICATION_TOKEN, 'Tamara', 'TAMARA_NOTIFICATION_TOKEN')) return

  /* Verify JWT when notification token is configured */
  if (env.TAMARA_NOTIFICATION_TOKEN) {
    const authHeader = asString(req.headers['authorization'])
    const queryToken = asString(req.query['tamaraToken'])
    const tamaraToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : queryToken

    if (!tamaraToken) {
      logger.warn('Tamara webhook: missing tamaraToken in Authorization header or query param')
      res.status(200).json({ received: true })
      return
    }
    const valid = tamaraSvc.verifyWebhookJwt(tamaraToken, env.TAMARA_NOTIFICATION_TOKEN)
    if (!valid) {
      logger.warn('Tamara webhook: JWT verification failed')
      res.status(200).json({ received: true })
      return
    }
  }

  let payload: any
  try {
    const raw = req.body
    payload = Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : (typeof raw === 'string' ? JSON.parse(raw) : raw)
  } catch {
    res.status(200).json({ received: true })
    return
  }

  try {
    /*
     * Tamara ORDER_APPROVED payload:
     *   event_type:         'ORDER_APPROVED'
     *   order_id:           Tamara internal order ID
     *   order_reference_id: our order ID (set in merchant_url notification)
     */
    const eventType     = asString(payload?.event_type)
    const tamaraOrderId = asString(payload?.order_id)
    const ourOrderId    = asString(payload?.order_reference_id)

    if (eventType === 'ORDER_APPROVED' && tamaraOrderId) {
      await orderSvc.fulfillTamaraFromWebhook(tamaraOrderId, ourOrderId)
      logger.info({ tamaraOrderId, ourOrderId }, 'Tamara: order fulfilled via webhook')
    } else if ((eventType === 'ORDER_EXPIRED' || eventType === 'ORDER_DECLINED') && tamaraOrderId) {
      await orderSvc.cancelTamaraFromWebhook(tamaraOrderId, ourOrderId)
      logger.info({ tamaraOrderId, ourOrderId, eventType }, 'Tamara: order cancelled via webhook')
    } else {
      logger.debug({ eventType, tamaraOrderId }, 'Tamara webhook: ignored event')
    }
  } catch (err) {
    logger.error({ err, payload }, 'Tamara webhook handler error')
  }

  res.status(200).json({ received: true })
})

export default router
