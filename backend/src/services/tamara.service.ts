import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

/* ─── Tamara API types ────────────────────────────────── */

interface TamaraAmount {
  amount:   string
  currency: string
}

interface TamaraCheckoutRequest {
  order_reference_id: string
  total_amount:       TamaraAmount
  description:        string
  country_code:       string
  payment_type:       string
  instalments:        number
  locale:             string
  items: Array<{
    reference_id:    string
    type:            string
    name:            string
    sku:             string
    quantity:        number
    unit_price:      TamaraAmount
    total_amount:    TamaraAmount
    discount_amount: TamaraAmount
  }>
  consumer: {
    first_name:   string
    last_name:    string
    email:        string
    phone_number: string
  }
  merchant_url: {
    success:      string
    failure:      string
    cancel:       string
    notification: string
  }
  shipping_amount: TamaraAmount
  tax_amount:      TamaraAmount
  discount:        TamaraAmount
}

interface TamaraCheckoutResponse {
  checkout_id:  string
  checkout_url: string
  order_id:     string
}

export interface TamaraCreateCheckoutOptions {
  amountAED:   number    // decimal AED amount e.g. 199.00
  orderId:     string    // our LMS order ID → order_reference_id
  courseTitle: string
  courseId:    string
  buyerEmail:  string
  buyerName:   string
  buyerPhone?: string
  successUrl:  string
  cancelUrl:   string
  failureUrl:  string
}

export interface TamaraCheckoutResult {
  checkoutId:    string   // Tamara checkout session ID
  tamaraOrderId: string   // Tamara internal order ID (for capture)
  checkoutUrl:   string
}

/* ─── TamaraService ───────────────────────────────────── */

export class TamaraService {
  private get baseUrl() {
    return env.TAMARA_BASE_URL
  }

  /* Pre-checkout eligibility check via Tamara's payment-types endpoint.
     Returns available=true on API errors (fail-safe — show Tamara when uncertain). */
  async checkEligibility(amountAED: number, buyerPhone?: string): Promise<{
    available:       boolean
    rejectionReason: string | null
  }> {
    if (!env.TAMARA_API_KEY) return { available: false, rejectionReason: null }
    try {
      const resp = await fetch(`${this.baseUrl}/merchants/payment-types`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.TAMARA_API_KEY}` },
        body: JSON.stringify({
          country_code:  'AE',
          phone_number:  buyerPhone ?? '',
          order_value:   { amount: amountAED.toFixed(2), currency: env.TAMARA_CURRENCY },
        }),
      })
      if (!resp.ok) return { available: true, rejectionReason: null }   // fail-safe
      /* payment_types is an array of available BNPL products.
         Empty array or missing has_instalments means ineligible. */
      const data = await resp.json() as { payment_types?: string[]; has_instalments?: boolean }
      const eligible = (data.payment_types?.length ?? 0) > 0 || data.has_instalments !== false
      if (!eligible) {
        return { available: false, rejectionReason: 'not_eligible' }
      }
      return { available: true, rejectionReason: null }
    } catch {
      return { available: true, rejectionReason: null }                 // fail-safe on network errors
    }
  }

  async createCheckout(opts: TamaraCreateCheckoutOptions): Promise<TamaraCheckoutResult> {
    if (!env.TAMARA_API_KEY) {
      throw new Error('TAMARA_API_KEY must be configured')
    }

    const amountStr  = opts.amountAED.toFixed(2)
    const currency   = env.TAMARA_CURRENCY
    const webhookUrl = `${env.BACKEND_PUBLIC_URL}/api/v1/webhooks/tamara`

    /* Split name into first / last — Tamara requires both */
    const parts     = opts.buyerName.trim().split(' ')
    const firstName = parts[0] ?? opts.buyerName
    const lastName  = parts.slice(1).join(' ') || firstName

    const body: TamaraCheckoutRequest = {
      order_reference_id: opts.orderId,
      total_amount:       { amount: amountStr, currency },
      description:        `Delta Academy — ${opts.courseTitle}`,
      country_code:       'AE',
      payment_type:       'PAY_BY_INSTALMENTS',
      instalments:        3,
      locale:             'en_US',
      items: [{
        reference_id:    opts.courseId,
        type:            'Digital',
        name:            opts.courseTitle,
        sku:             opts.courseId,
        quantity:        1,
        unit_price:      { amount: amountStr, currency },
        total_amount:    { amount: amountStr, currency },
        discount_amount: { amount: '0.00',    currency },
      }],
      consumer: {
        first_name:   firstName,
        last_name:    lastName,
        email:        opts.buyerEmail,
        phone_number: opts.buyerPhone ?? '',
      },
      merchant_url: {
        success:      opts.successUrl,
        failure:      opts.failureUrl,
        cancel:       opts.cancelUrl,
        notification: webhookUrl,
      },
      shipping_amount: { amount: '0.00', currency },
      tax_amount:      { amount: '0.00', currency },
      discount:        { amount: '0.00', currency },
    }

    const resp = await fetch(`${this.baseUrl}/checkout`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.TAMARA_API_KEY}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const text = await resp.text()
      logger.error({ status: resp.status, body: text }, 'Tamara createCheckout failed')
      throw new Error(`Tamara API error ${resp.status}: ${text}`)
    }

    const data = await resp.json() as TamaraCheckoutResponse

    if (!data.checkout_url) {
      logger.error({ data }, 'Tamara: no checkout_url in response')
      throw new Error('Tamara checkout is not available for this transaction. Try another payment method.')
    }

    return {
      checkoutId:    data.checkout_id,
      tamaraOrderId: data.order_id,
      checkoutUrl:   data.checkout_url,
    }
  }

  /* Authorise a Tamara order after the customer approves payment.
     Moves order from `approved` → `authorised`.

     Returns whether Tamara ACCEPTED the authorisation. This used to return
     void and log failures as "(non-fatal)", which meant the caller could not
     tell an approved order from a rejected one — and fulfilled either way, so
     anyone could self-fulfil their own pending order for free (P-02). A
     successful authorise is the point at which the customer's funds are
     genuinely committed, so it is the correct gate for handing over a course. */
  async authoriseOrder(tamaraOrderId: string): Promise<boolean> {
    if (!env.TAMARA_API_KEY) {
      logger.error({ tamaraOrderId }, 'Tamara authorise: TAMARA_API_KEY not configured — refusing to treat as paid')
      return false
    }
    const resp = await fetch(`${this.baseUrl}/orders/${tamaraOrderId}/authorise`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.TAMARA_API_KEY}`,
      },
      body: JSON.stringify({}),
    })
    if (!resp.ok) {
      const text = await resp.text()
      logger.error({ status: resp.status, tamaraOrderId, text }, 'Tamara authorise FAILED — order will not be fulfilled')
      return false
    }
    return true
  }

  /* Capture (settle) a Tamara order — required to move to fully_captured and trigger settlement.
     For digital goods, call immediately after authorise.
     amountAED: decimal string e.g. "199.00", courseTitle+courseId for items */
  /* Returns whether Tamara accepted the capture. The caller fulfils on a
     successful AUTHORISE (funds committed); a failed capture is a settlement
     problem to chase, not a reason to withhold a course the customer has
     already committed to pay for — but it must be loud, not "(non-fatal)". */
  async captureOrder(opts: {
    tamaraOrderId: string
    amountAED:     string
    courseTitle:   string
    courseId:      string
  }): Promise<boolean> {
    if (!env.TAMARA_API_KEY) return false
    const now = new Date().toISOString()
    const resp = await fetch(`${this.baseUrl}/payments/capture`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.TAMARA_API_KEY}`,
      },
      body: JSON.stringify({
        order_id:     opts.tamaraOrderId,
        total_amount: { amount: opts.amountAED, currency: env.TAMARA_CURRENCY },
        shipping_info: {
          shipped_at:       now,
          shipping_company: 'Digital Delivery',
          tracking_number:  opts.tamaraOrderId,
        },
        items: [{
          name:         opts.courseTitle,
          quantity:     1,
          reference_id: opts.courseId,
          sku:          opts.courseId,
          total_amount: { amount: opts.amountAED, currency: env.TAMARA_CURRENCY },
          unit_price:   { amount: opts.amountAED, currency: env.TAMARA_CURRENCY },
          type:         'Digital',
        }],
      }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      logger.error(
        { status: resp.status, tamaraOrderId: opts.tamaraOrderId, text },
        'Tamara capture FAILED — order was authorised and fulfilled, settlement needs manual follow-up',
      )
      return false
    }
    return true
  }

  /* Verify Tamara webhook JWT (HS256).
     Tamara attaches a JWT signed with the Notification Token in:
       - Authorization: Bearer <tamaraToken>
       - ?tamaraToken=<tamaraToken> query parameter
     Verification: recompute HMAC-SHA256 over header.payload and compare. */
  verifyWebhookJwt(tamaraToken: string, notificationToken: string): boolean {
    try {
      const parts = tamaraToken.split('.')
      if (parts.length !== 3) return false
      const [header, payload, signature] = parts as [string, string, string]
      const computed = createHmac('sha256', notificationToken)
        .update(`${header}.${payload}`)
        .digest('base64url')
      const a = Buffer.from(computed)
      const b = Buffer.from(signature)
      if (a.length !== b.length) return false
      return timingSafeEqual(a, b)
    } catch {
      return false
    }
  }
}
