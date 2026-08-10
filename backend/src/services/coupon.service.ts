import { Types } from 'mongoose'
import { CouponRepository } from '@/repositories/coupon.repository.ts'
import { CouponModel, CourseModel, type ICoupon } from '@/models/schema.ts'

export class CouponError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'CouponError'
  }
}

export class CouponService {
  private readonly repo = new CouponRepository()

  /* ─── Validate coupon for a course ──────────────────
     Returns the coupon if valid, throws CouponError if not.
     Does NOT claim a usage slot — this is the read-only preview path.
     Callers that are about to create an order must use validateAndReserve(). */
  async validate(code: string, courseId: string): Promise<ICoupon> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new CouponError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }

    /* Tenancy — resolved by construction rather than by a separate check.
       Codes are unique per organisation, so the coupon is looked up in the
       organisation that owns THE COURSE. An Org A code simply does not exist
       for an Org B course, and comes back as COUPON_NOT_FOUND. */
    const course = await CourseModel.findById(courseId).select('organizationId').lean().exec()
    if (!course) throw new CouponError('COURSE_NOT_FOUND', 'Course not found', 404)

    const coupon = await this.repo.findByCodeAndOrg(code, course.organizationId?.toString())
    if (!coupon) throw new CouponError('COUPON_NOT_FOUND', 'Coupon not found or invalid', 404)
    if (!coupon.isActive) throw new CouponError('COUPON_INACTIVE', 'This coupon is no longer active', 400)
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      throw new CouponError('COUPON_EXPIRED', 'This coupon has expired', 400)
    }
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
      throw new CouponError('COUPON_EXHAUSTED', 'This coupon has reached its usage limit', 400)
    }
    if (coupon.appliesTo.length > 0) {
      const applies = coupon.appliesTo.some(id => id.toString() === courseId)
      if (!applies) throw new CouponError('COUPON_NOT_APPLICABLE', 'This coupon does not apply to this course', 400)
    }
    return coupon
  }

  /* ─── Apply a coupon to an amount in MINOR UNITS ──────
     `checkoutCurrency` is the currency the caller is charging in — AED fils
     for Abzer/Tabby/Tamara, INR paise for Razorpay, USD cents for Stripe.

     PERCENT is a ratio, so it is currency-neutral and unchanged.

     FIXED is not (N-01). `discountValue` used to be documented as USD dollars
     and applied as `value * 100` against whatever minor unit the gateway
     passed in, with nothing comparing the two. So one "50" coupon took 50 AED
     off an Abzer checkout, 50 INR off a Razorpay one, and $50 off a Stripe
     one — roughly 22x apart, and only the last matched the documented intent.
     Worse in the other direction: because the discount is capped at the order
     total, a value entered in the "wrong" currency (5000, meaning ₹5,000)
     could exceed an AED-denominated price outright and zero the order.

     `discountValue` is now major units of the coupon's OWN currency, stamped
     from its academy at create time. A mismatch is refused rather than
     converted: there is no USD→INR rate in this codebase (UAE_EXCHANGE_RATE
     covers AED only, and Razorpay hardcodes 83 inline), and a dirham promo
     silently becoming a rupee one is a business error, not a rounding one. */
  applyDiscount(
    originalMinorUnits: number,
    coupon: ICoupon,
    checkoutCurrency: string,
  ): { finalCents: number; discountCents: number } {
    let discountCents: number

    if (coupon.discountType === 'percent') {
      discountCents = Math.round(originalMinorUnits * (coupon.discountValue / 100))
    } else {
      const couponCurrency = coupon.currency
      if (!couponCurrency) {
        /* Predates the field and the boot backfill has not stamped it. Refuse
           rather than guess — guessing is what produced N-01. */
        throw new CouponError(
          'COUPON_CURRENCY_UNKNOWN',
          'This coupon has no currency on record and cannot be applied. Please re-create it.',
          409,
        )
      }
      if (couponCurrency !== checkoutCurrency.toUpperCase()) {
        throw new CouponError(
          'COUPON_CURRENCY_MISMATCH',
          `This coupon is issued in ${couponCurrency} and cannot be used with a ${checkoutCurrency.toUpperCase()} payment method.`,
          400,
        )
      }
      discountCents = Math.round(coupon.discountValue * 100)
    }

    discountCents = Math.min(discountCents, originalMinorUnits)
    return {
      finalCents:    originalMinorUnits - discountCents,
      discountCents,
    }
  }

  /* ─── Validate + claim one usage slot ───────────────
     Used at ORDER-CREATION time so the DISCOUNT is capped, not just the
     counter: without this, N shoppers can all pass validate() on a maxUses=1
     coupon and all N get the discount, because fulfilment happens after they
     have already paid.
     Throws COUPON_EXHAUSTED when the last slot was taken by someone else.
     Give the slot back with release() if the order never completes. */
  async validateAndReserve(code: string, courseId: string): Promise<ICoupon> {
    const coupon   = await this.validate(code, courseId)
    const reserved = await this.reserve(coupon.id)
    if (!reserved) {
      throw new CouponError('COUPON_EXHAUSTED', 'This coupon has reached its usage limit', 400)
    }
    return coupon
  }

  /* ─── Validate + price + claim, in that order ───────
     Every checkout path needs all three, and the ORDER matters: pricing must
     happen BEFORE the usage slot is claimed.

     validateAndReserve() claims the slot first, so any later throw leaks it.
     That was harmless while applyDiscount() could not fail — it now can, on a
     currency mismatch (N-01), and the release wrapper in OrderService only
     covers the region *after* the reservation. A mismatched attempt would
     therefore burn a use off maxUses permanently, which is N-03 all over again.

     Pricing first costs nothing: validate() is already a read, and a coupon
     that cannot be applied should never have consumed a slot in the first
     place. Only once the amount is known do we claim. */
  async validateAndPrice(
    code:             string,
    courseId:         string,
    originalMinorUnits: number,
    checkoutCurrency: string,
  ): Promise<{ coupon: ICoupon; finalCents: number; discountCents: number }> {
    const coupon  = await this.validate(code, courseId)
    const applied = this.applyDiscount(originalMinorUnits, coupon, checkoutCurrency)

    const reserved = await this.reserve(coupon.id)
    if (!reserved) {
      throw new CouponError('COUPON_EXHAUSTED', 'This coupon has reached its usage limit', 400)
    }
    return { coupon, ...applied }
  }

  /* ─── Reserve — atomic, re-checks the usage cap ─────
     The cap is re-evaluated inside the update filter so concurrent
     reservations can never push usedCount past maxUses.
     maxUses 0 / unset means unlimited.
     Returns false when the coupon is already exhausted. */
  async reserve(couponId: string): Promise<boolean> {
    const result = await CouponModel.updateOne(
      {
        _id: couponId,
        $or: [
          { maxUses: null },
          { maxUses: { $lte: 0 } },
          { $expr: { $lt: ['$usedCount', '$maxUses'] } },
        ],
      },
      { $inc: { usedCount: 1 } },
    ).exec()
    return result.modifiedCount > 0
  }

  /* ─── Release — hand a reserved slot back ───────────
     Floored at 0 by the usedCount filter, so a duplicated release can never
     drive the counter negative. Called when a reserved order is cancelled. */
  async release(couponId: string): Promise<boolean> {
    const result = await CouponModel.updateOne(
      { _id: couponId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
    ).exec()
    return result.modifiedCount > 0
  }

  /* ─── Admin CRUD ────────────────────────────────── */
  async create(data: {
    code:            string
    discountType:    'percent' | 'fixed'
    discountValue:   number
    maxUses?:        number
    expiresAt?:      string   // ISO string
    appliesTo?:      string[]
    organizationId?: string
  }): Promise<ICoupon> {
    /* Every coupon belongs to exactly one academy. A super_admin with no
       active organisation selected has nothing to attach it to — fail with
       something actionable rather than a Mongoose validation error. */
    if (!data.organizationId || !Types.ObjectId.isValid(data.organizationId)) {
      throw new CouponError(
        'ORGANIZATION_REQUIRED',
        'Select an organization before creating a coupon. Super admins must pick an active organization first.',
        400,
      )
    }

    /* Duplicate check is scoped to the organisation — the other academy is
       free to run the same code on its own catalogue. */
    const existing = await this.repo.findByCodeAndOrg(data.code, data.organizationId)
    if (existing) {
      throw new CouponError(
        'COUPON_CODE_EXISTS',
        `Coupon code "${data.code}" already exists in this organization`,
        409,
      )
    }

    if (data.discountType === 'percent' && (data.discountValue < 1 || data.discountValue > 100)) {
      throw new CouponError('INVALID_DISCOUNT', 'Percent discount must be 1–100', 400)
    }
    if (data.discountType === 'fixed' && data.discountValue <= 0) {
      throw new CouponError('INVALID_DISCOUNT', 'Fixed discount must be > 0', 400)
    }

    await this.assertAppliesToInOrg(data.appliesTo, data.organizationId)

    /* Stamp the currency from the owning academy (N-01). A fixed-amount
       discount is meaningless without one, and deriving it at redemption from
       whichever gateway the buyer happened to pick is exactly the bug. */
    const { OrganizationModel } = await import('@/models/schema.ts')
    const org = await OrganizationModel.findById(data.organizationId).select('currency').lean()
    if (!org?.currency) {
      throw new CouponError(
        'ORGANIZATION_CURRENCY_MISSING',
        'The selected organization has no currency configured, so a discount amount cannot be interpreted.',
        409,
      )
    }

    try {
      return await this.repo.create({
        ...data,
        organizationId: data.organizationId,
        currency:       org.currency as 'AED' | 'INR',
        expiresAt:      data.expiresAt ? new Date(data.expiresAt) : undefined,
      })
    } catch (err) {
      /* Two concurrent creates can both clear the duplicate check above and
         race to the insert; the compound unique index catches the loser. Map
         it to the same 409 the sequential path returns, so the caller never
         sees a raw driver error. */
      if ((err as { code?: number }).code === 11000) {
        throw new CouponError(
          'COUPON_CODE_EXISTS',
          `Coupon code "${data.code}" already exists in this organization`,
          409,
        )
      }
      throw err
    }
  }

  async list(page = 1, perPage = 50, organizationId?: string) {
    return this.repo.listAll(page, perPage, organizationId)
  }

  /* `organizationId` scopes the write. Passing it means "only if this coupon
     belongs to my academy"; omitting it is the unscoped super_admin case.
     A coupon outside the caller's scope reports COUPON_NOT_FOUND rather than
     FORBIDDEN, so the endpoint does not confirm that the id exists. */
  async update(id: string, patch: {
    discountType?:  'percent' | 'fixed'
    discountValue?: number
    maxUses?:       number
    expiresAt?:     string | null
    isActive?:      boolean
    appliesTo?:     string[]
  }, organizationId?: string): Promise<ICoupon> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new CouponError('COUPON_NOT_FOUND', 'Coupon not found', 404)
    if (organizationId && String(existing.organizationId ?? '') !== organizationId) {
      throw new CouponError('COUPON_NOT_FOUND', 'Coupon not found', 404)
    }

    await this.assertAppliesToInOrg(patch.appliesTo, String(existing.organizationId ?? ''))

    const update: Record<string, unknown> = { ...patch }
    /* A coupon never moves between academies — its code is only unique within
       one, so relocating it could collide, and it would silently transfer a
       discount to another tenant's catalogue. `currency` follows the academy,
       so it is equally immutable: re-denominating a live coupon would change
       what every holder is charged (N-01). */
    delete update['organizationId']
    delete update['code']
    delete update['usedCount']
    delete update['currency']

    if ('expiresAt' in patch) {
      update['expiresAt'] = patch.expiresAt ? new Date(patch.expiresAt) : null
    }

    const updated = await this.repo.update(id, update as never, organizationId)
    if (!updated) throw new CouponError('COUPON_NOT_FOUND', 'Coupon not found', 404)
    return updated
  }

  async remove(id: string, organizationId?: string): Promise<void> {
    const deleted = await this.repo.deleteById(id, organizationId)
    if (!deleted) throw new CouponError('COUPON_NOT_FOUND', 'Coupon not found', 404)
  }

  /* ─── appliesTo tenancy ─────────────────────────────
     A coupon may only single out courses from its own academy. Without this a
     Dubai coupon could name a Bangalore course, which validate() would then
     never match — an un-diagnosable "valid coupon that never applies". */
  private async assertAppliesToInOrg(appliesTo: string[] | undefined, organizationId: string): Promise<void> {
    if (!appliesTo || appliesTo.length === 0) return

    const ids = appliesTo.filter(id => Types.ObjectId.isValid(id))
    if (ids.length !== appliesTo.length) {
      throw new CouponError('INVALID_APPLIES_TO', 'appliesTo contains an invalid course id', 400)
    }

    const inOrg = await CourseModel.countDocuments({
      _id: { $in: ids.map(id => new Types.ObjectId(id)) },
      ...(Types.ObjectId.isValid(organizationId)
        ? { organizationId: new Types.ObjectId(organizationId) }
        : { organizationId: null }),
    }).exec()

    if (inOrg !== ids.length) {
      throw new CouponError(
        'INVALID_APPLIES_TO',
        'A coupon can only be restricted to courses in its own organization',
        400,
      )
    }
  }
}
