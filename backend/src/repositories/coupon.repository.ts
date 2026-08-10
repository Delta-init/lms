import { Types } from 'mongoose'
import { CouponModel, type ICoupon } from '@/models/schema.ts'

export class CouponRepository {

  /* Coupon codes are unique per ORGANISATION, not globally, so a lookup by
     code alone is ambiguous — two academies may both own "SUMMER20". Every
     caller must say which organisation it means.

     `organizationId` omitted matches only coupons that have no organisation
     (pre-tenancy rows the boot backfill has not reached). `null` in a Mongo
     filter matches both an explicit null and a missing field. */
  async findByCodeAndOrg(code: string, organizationId?: string): Promise<ICoupon | null> {
    return CouponModel.findOne({
      code: code.toUpperCase().trim(),
      organizationId: organizationId && Types.ObjectId.isValid(organizationId)
        ? new Types.ObjectId(organizationId)
        : null,
    }).exec()
  }

  async findById(id: string): Promise<ICoupon | null> {
    return CouponModel.findById(id).exec()
  }

  async listAll(page = 1, perPage = 50, organizationId?: string): Promise<{ docs: ICoupon[]; totalCount: number }> {
    const filter: Record<string, unknown> = {}
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter['organizationId'] = new Types.ObjectId(organizationId)
    }
    const [docs, totalCount] = await Promise.all([
      CouponModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).exec(),
      CouponModel.countDocuments(filter).exec(),
    ])
    return { docs, totalCount }
  }

  async create(data: {
    code:            string
    discountType:    'percent' | 'fixed'
    discountValue:   number
    maxUses?:        number
    expiresAt?:      Date
    isActive?:       boolean
    appliesTo?:      string[]
    organizationId:  string      // required — coupons are per-organisation
    currency?:       'AED' | 'INR'  // major-unit currency for discountType 'fixed' (N-01)
  }): Promise<ICoupon> {
    if (!Types.ObjectId.isValid(data.organizationId)) {
      throw new Error(`Invalid organizationId for coupon: ${data.organizationId}`)
    }
    return CouponModel.create({
      ...data,
      code:           data.code.toUpperCase().trim(),
      usedCount:      0,
      organizationId: new Types.ObjectId(data.organizationId),
    })
  }

  /* Address a coupon by id AND owning organisation, so a by-id write can never
     reach another academy's coupon. An omitted organizationId is deliberately
     unscoped — that is the super_admin case, matching the convention used by
     the admin bulk/orders routes. */
  private scopeFilter(id: string, organizationId?: string): Record<string, unknown> {
    const filter: Record<string, unknown> = { _id: new Types.ObjectId(id) }
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter['organizationId'] = new Types.ObjectId(organizationId)
    }
    return filter
  }

  async update(id: string, patch: Partial<Pick<ICoupon,
    'discountType' | 'discountValue' | 'maxUses' | 'expiresAt' | 'isActive' | 'appliesTo'
  >>, organizationId?: string): Promise<ICoupon | null> {
    if (!Types.ObjectId.isValid(id)) return null
    return CouponModel.findOneAndUpdate(
      this.scopeFilter(id, organizationId),
      { $set: patch },
      { new: true },
    ).exec()
  }

  /* NOTE: no incrementUsage() here on purpose — an uncapped $inc bypasses the
     maxUses cap. Claim a usage slot via CouponService.reserve() instead. */

  /** True only when a coupon was actually removed within the caller's scope. */
  async deleteById(id: string, organizationId?: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false
    const result = await CouponModel.deleteOne(this.scopeFilter(id, organizationId)).exec()
    return (result.deletedCount ?? 0) > 0
  }
}
