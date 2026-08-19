/* ─────────────────────────────────────────────────────
   coursePrice — show every course price in the currency
   the student will actually be charged in.

   The backend's /checkout/config resolves the student's
   payment market from their registration country:
     Middle East → Abzer (AED) · everyone else → Razorpay (INR)
   Course payloads carry the backend-resolved priceAED /
   priceINR (override or USD × configured rate), so the
   label on a card and the charge at the gateway always
   agree. Signed-out (or config still loading) falls back
   to the base USD price.
───────────────────────────────────────────────────── */
import { useGatewayConfig } from '@/lib/api/checkout'
import { formatPrice } from '@/lib/formatPrice'

export type CheckoutCurrency = 'AED' | 'INR' | 'USD'

export function useCheckoutCurrency(): CheckoutCurrency {
  const { data } = useGatewayConfig()
  return data?.currency === 'AED' || data?.currency === 'INR' ? data.currency : 'USD'
}

interface Priced { price?: number; priceAED?: number; priceINR?: number; isFree?: boolean }

/** The amount+currency this student's checkout would charge for the course. */
export function coursePriceIn(course: Priced, currency: CheckoutCurrency): { amount: number; currency: CheckoutCurrency } {
  if (currency === 'AED' && course.priceAED != null) return { amount: course.priceAED, currency }
  if (currency === 'INR' && course.priceINR != null) return { amount: course.priceINR, currency }
  return { amount: course.price ?? 0, currency: 'USD' }
}

export function formatCoursePrice(course: Priced, currency: CheckoutCurrency): string {
  const p = coursePriceIn(course, currency)
  return formatPrice(p.amount, p.currency)
}

/** Coupon math in the DISPLAY currency: percent scales; fixed coupons are
    minted per academy in the student's own checkout currency, so the value
    subtracts directly. */
export function discountedAmount(
  amount: number,
  coupon?: { discountType: 'percent' | 'fixed'; discountValue: number } | null,
): number {
  if (!coupon) return amount
  if (coupon.discountType === 'percent') {
    return Math.max(0, amount * (1 - coupon.discountValue / 100))
  }
  return Math.max(0, amount - coupon.discountValue)
}
