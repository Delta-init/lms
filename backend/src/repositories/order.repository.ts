import { OrderModel, type IOrder, type OrderGateway } from '@/models/schema.ts'

export class OrderRepository {

  async create(data: {
    userId:                   string
    courseId:                 string
    gateway:                  OrderGateway
    amount:                   number
    currency:                 string
    couponId?:                string
    discountAmount?:          number
    razorpayOrderId?:         string
    stripeCheckoutSessionId?: string
    tabbyCheckoutId?:         string
    tabbyPaymentId?:          string
    abzerOrderId?:            string
    tamaraCheckoutId?:        string
    tamaraOrderId?:           string
  }): Promise<IOrder> {
    return OrderModel.create({
      ...data,
      status:         'pending',
      discountAmount: data.discountAmount ?? 0,
    })
  }

  async findById(id: string): Promise<IOrder | null> {
    return OrderModel.findById(id).exec()
  }

  async findBySessionId(sessionId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ stripeCheckoutSessionId: sessionId }).exec()
  }

  async findByRazorpayOrderId(razorpayOrderId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ razorpayOrderId }).exec()
  }

  async findByTabbyCheckoutId(tabbyCheckoutId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ tabbyCheckoutId }).exec()
  }

  async findByTabbyPaymentId(tabbyPaymentId: string): Promise<IOrder | null> {
    if (!tabbyPaymentId) return null
    return OrderModel.findOne({ tabbyPaymentId }).exec()
  }

  async findByAbzerOrderId(abzerOrderId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ abzerOrderId }).exec()
  }

  async findByTamaraOrderId(tamaraOrderId: string): Promise<IOrder | null> {
    return OrderModel.findOne({ tamaraOrderId }).exec()
  }

  /* ─── Fulfilment — conditional, exactly-once ─────────
     `status: { $ne: 'paid' }` lives in the FILTER so a gateway webhook racing
     the client return-URL verify (or a retried webhook) cannot fulfil twice.
     Each returns true only for the caller that actually flipped the order;
     the loser must skip enrolment / emails / coupon side effects. */

  /* Stripe fulfillment */
  async fulfill(id: string, paymentIntentId: string, invoiceUrl?: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', stripePaymentIntentId: paymentIntentId, ...(invoiceUrl && { stripeInvoiceUrl: invoiceUrl }) } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Razorpay fulfillment */
  async fulfillRazorpay(id: string, paymentId: string, signature: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', razorpayPaymentId: paymentId, razorpaySignature: signature } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Tabby fulfillment */
  async fulfillTabby(id: string, paymentId: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', tabbyPaymentId: paymentId } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Abzer fulfillment */
  async fulfillAbzer(id: string, paymentId: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', abzerPaymentId: paymentId } },
    ).exec()
    return result.modifiedCount === 1
  }

  /* Tamara fulfillment */
  async fulfillTamara(id: string, tamaraOrderId: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', tamaraPaymentId: tamaraOrderId } },
    ).exec()
    return result.modifiedCount === 1
  }

  async markRefunded(id: string): Promise<IOrder | null> {
    return OrderModel.findByIdAndUpdate(
      id,
      { $set: { status: 'refunded', refundedAt: new Date() } },
      { new: true },
    ).exec()
  }

  /* Conditional for the same reason as the fulfil methods — true only for the
     caller that actually cancelled, so a reserved coupon slot is released once. */
  async markCancelled(id: string): Promise<boolean> {
    const result = await OrderModel.updateOne(
      { _id: id, status: 'pending' },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
    ).exec()
    return result.modifiedCount === 1
  }

  async listForUser(userId: string): Promise<IOrder[]> {
    return OrderModel
      .find({ userId })
      .populate('courseId', 'title slug thumbnailUrl')
      .sort({ createdAt: -1 })
      .exec()
  }

  async listAll(page = 1, perPage = 20, status?: string, organizationId?: string): Promise<{ docs: IOrder[]; totalCount: number }> {
    const filter: Record<string, unknown> = status && status !== 'all' ? { status } : {}
    if (organizationId) {
      const { Types } = await import('mongoose')
      if (Types.ObjectId.isValid(organizationId)) filter['organizationId'] = new Types.ObjectId(organizationId)
    }
    const [docs, totalCount] = await Promise.all([
      OrderModel
        .find(filter)
        .populate('userId',   'name email')
        .populate('courseId', 'title slug')
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .exec(),
      OrderModel.countDocuments(filter).exec(),
    ])
    return { docs, totalCount }
  }

  async revenueTimeseries(days: number, organizationId?: string): Promise<{ date: string; amount: number }[]> {
    const since = new Date()
    since.setDate(since.getDate() - days)

    const matchBase: Record<string, unknown> = { status: 'paid', createdAt: { $gte: since } }
    if (organizationId) {
      const { Types } = await import('mongoose')
      if (Types.ObjectId.isValid(organizationId)) matchBase['organizationId'] = new Types.ObjectId(organizationId)
    }
    const rows = await OrderModel.aggregate([
      { $match: matchBase },
      {
        $group: {
          _id:    { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ])

    const byDate = new Map<string, number>(rows.map((r: any) => [r._id, r.amount]))
    const out: { date: string; amount: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      out.push({ date: key, amount: byDate.get(key) ?? 0 })
    }
    return out
  }

  async totalRevenue(): Promise<number> {
    const result = await OrderModel.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    return result[0]?.total ?? 0
  }
}
