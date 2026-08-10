/* ─────────────────────────────────────────────────────────────
   Security regression suite — pure logic, no database.

   Covers the fixes whose whole value is in a decision function, where a
   silent revert would not fail a type-check and would not be obvious in
   review:

     • documentRef      (P-07 / P-19)  which document references are accepted
     • coupon currency  (N-01)         cross-currency discounts are refused
     • coupon slot leak (N-01 regression) a refused coupon must not burn a use
     • mux signature    (NEW-02)       replayed webhooks are refused

   Run: bun run test:security
───────────────────────────────────────────────────────────── */
process.env.MUX_WEBHOOK_SECRET = 'suite-webhook-secret'
delete process.env.MUX_WEBHOOK_TOLERANCE_SECONDS

import { createHmac } from 'node:crypto'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(name: string) { lines.push(`\n${name}`) }

/* ══ 1. Document references (P-07 / P-19) ══════════════════ */
section('documentRef — which values may be stored as an identity document')
{
  const { isValidDocumentRef } = await import('@/utils/documentRef.ts')
  const { env } = await import('@/config/env.ts')

  const cases: [string, boolean, string][] = [
    ['kyc/1770000000-a1b2c3d4.jpg',                      true,  'key from POST /uploads/kyc — the P-07 repair'],
    ['kyc/upload.pdf',                                    true,  'key, pdf'],
    ['',                                                  true,  'empty = field left unset'],
    [`${env.R2_PUBLIC_URL}/documents/x.jpg`,              true,  'legacy public documents/ URL'],
    [`${env.R2_PUBLIC_URL}/images/avatar.png`,            true,  'photoUrl from /uploads/document'],
    [`${env.BACKEND_PUBLIC_URL}/uploads/images/a.png`,    true,  'local-disk fallback URL'],
    ['https://attacker.example/track.png',                false, 'foreign host — P-19'],
    ['kyc/../../etc/passwd',                              false, 'traversal in key'],
    ['kyc/',                                              false, 'empty key name'],
    ['javascript:alert(1)',                               false, 'script URL'],
    ['//evil.example/x.jpg',                              false, 'protocol-relative'],
    ['not a url at all',                                  false, 'garbage'],
  ]
  for (const [value, want, why] of cases) {
    check(why, isValidDocumentRef(value) === want)
  }
}

/* ══ 2. Coupon currency (N-01) ═════════════════════════════ */
section('coupon currency — a fixed discount is in its academy\'s currency')
{
  const { CouponService, CouponError } = await import('@/services/coupon.service.ts')
  const svc = new CouponService()
  const coupon = (t: 'percent' | 'fixed', v: number, cur?: string) =>
    ({ discountType: t, discountValue: v, currency: cur } as any)

  const outcome = (fn: () => unknown): string => {
    try {
      const r = fn() as { finalCents: number; discountCents: number }
      return `discount=${r.discountCents} final=${r.finalCents}`
    } catch (e) { return e instanceof CouponError ? e.code : `UNEXPECTED:${(e as Error).message}` }
  }
  /* A $100 course = 36700 fils (AED) / 830000 paise (INR). */
  const cases: [string, () => unknown, string][] = [
    ['percent is currency-neutral (AED)',        () => svc.applyDiscount(36700, coupon('percent', 10, 'AED'), 'AED'), 'discount=3670 final=33030'],
    ['percent is currency-neutral (INR)',        () => svc.applyDiscount(830000, coupon('percent', 10, 'INR'), 'INR'), 'discount=83000 final=747000'],
    ['percent works without a currency',         () => svc.applyDiscount(36700, coupon('percent', 10), 'AED'),        'discount=3670 final=33030'],
    ['fixed AED on an AED checkout',             () => svc.applyDiscount(36700, coupon('fixed', 50, 'AED'), 'AED'),   'discount=5000 final=31700'],
    ['fixed INR on an INR checkout',             () => svc.applyDiscount(830000, coupon('fixed', 500, 'INR'), 'INR'), 'discount=50000 final=780000'],
    ['THE BUG: INR coupon on an AED checkout',   () => svc.applyDiscount(36700, coupon('fixed', 5000, 'INR'), 'AED'), 'COUPON_CURRENCY_MISMATCH'],
    ['THE BUG: AED coupon on an INR checkout',   () => svc.applyDiscount(830000, coupon('fixed', 50, 'AED'), 'INR'),  'COUPON_CURRENCY_MISMATCH'],
    ['AED coupon on a USD (Stripe) checkout',    () => svc.applyDiscount(10000, coupon('fixed', 50, 'AED'), 'usd'),   'COUPON_CURRENCY_MISMATCH'],
    ['legacy fixed coupon is refused, not guessed', () => svc.applyDiscount(36700, coupon('fixed', 50), 'AED'),       'COUPON_CURRENCY_UNKNOWN'],
    ['currency compare is case-insensitive',     () => svc.applyDiscount(36700, coupon('fixed', 50, 'AED'), 'aed'),   'discount=5000 final=31700'],
    ['over-large fixed caps at the total',       () => svc.applyDiscount(36700, coupon('fixed', 9999, 'AED'), 'AED'), 'discount=36700 final=0'],
  ]
  for (const [why, fn, want] of cases) {
    const got = outcome(fn)
    check(why, got === want, `got ${got}, want ${want}`)
  }
}

/* ══ 3. Coupon slot leak (the N-01 regression) ═════════════ */
section('coupon slots — a coupon that cannot be applied must not burn a use')
{
  const { CouponService, CouponError } = await import('@/services/coupon.service.ts')
  const svc = new CouponService() as any
  let used = 0
  const c = { id: 'c1', code: 'X', discountType: 'fixed', discountValue: 50, currency: 'INR', appliesTo: [] }
  svc.validate = async () => c
  svc.reserve  = async () => { used++; return true }

  const attempt = async (cur: string) => {
    try { await svc.validateAndPrice('X', 'course1', 830000, cur); return 'priced' }
    catch (e) { return e instanceof CouponError ? e.code : 'UNEXPECTED' }
  }

  const before = used
  check('matching currency prices and claims one slot',
    (await attempt('INR')) === 'priced' && used - before === 1)

  const b2 = used
  check('first mismatch is refused and claims nothing',
    (await attempt('AED')) === 'COUPON_CURRENCY_MISMATCH' && used - b2 === 0)

  const b3 = used
  check('repeated mismatches never accumulate',
    (await attempt('AED')) === 'COUPON_CURRENCY_MISMATCH' && used - b3 === 0)
}

/* ══ 4. Mux webhook signature freshness (NEW-02) ═══════════ */
section('mux webhook — a signature is only valid near the moment it was made')
{
  const { verifyWebhookSignature } = await import('@/services/mux.service.ts')
  const SECRET = 'suite-webhook-secret'
  const BODY   = JSON.stringify({ type: 'video.live_stream.active', data: { id: 'abc' } })
  const NOW    = 1_770_000_000_000
  const nowSec = NOW / 1000
  const sign = (ts: number, body = BODY, secret = SECRET) =>
    `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`

  const cases: [string, string | undefined, string, boolean][] = [
    ['freshly signed',                       sign(nowSec),                    BODY, true ],
    ['4 minutes old — inside the window',    sign(nowSec - 240),              BODY, true ],
    ['5 minutes old — exactly the boundary', sign(nowSec - 300),              BODY, true ],
    ['REPLAY: 6 minutes old',                sign(nowSec - 360),              BODY, false],
    ['REPLAY: captured a day ago',           sign(nowSec - 86_400),           BODY, false],
    ['future-dated by 6 minutes',            sign(nowSec + 360),              BODY, false],
    ['forged v1 (wrong secret)',             sign(nowSec, BODY, 'nope'),      BODY, false],
    ['valid signature, TAMPERED body',       sign(nowSec),      '{"type":"evil"}', false],
    ['non-numeric timestamp',                `t=abc,v1=${'0'.repeat(64)}`,    BODY, false],
    ['missing v1',                           `t=${nowSec}`,                   BODY, false],
    ['missing t',                            `v1=${'0'.repeat(64)}`,          BODY, false],
    ['header absent',                        undefined,                       BODY, false],
    ['garbage header',                       'not-a-signature',               BODY, false],
  ]
  for (const [why, header, body, want] of cases) {
    check(why, verifyWebhookSignature(Buffer.from(body), header, NOW) === want)
  }
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
