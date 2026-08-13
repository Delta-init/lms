'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { ShoppingBag, ExternalLink, CheckCircle2, Clock, RotateCcw } from 'lucide-react'
import { useMyOrders, type MyOrder } from '@/lib/api/checkout'
import { formatPrice } from '@/lib/formatPrice'
import Spinner from '@/components/ui/Spinner'

function asCourse(o: MyOrder) {
  return typeof o.courseId === 'object' && o.courseId !== null ? o.courseId : null
}

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  paid:     { label: 'Paid',     color: 'var(--color-success)', bg: 'rgba(16,185,129,0.10)',   icon: CheckCircle2 },
  pending:  { label: 'Pending',  color: 'var(--color-warning)', bg: 'rgba(245,158,11,0.10)',  icon: Clock },
  refunded: { label: 'Refunded', color: 'var(--color-text-muted)', bg: 'rgba(107,114,128,0.10)', icon: RotateCcw },
}

export default function OrdersPage() {
  const { data: orders, isLoading } = useMyOrders()

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-3">
        <Spinner size={20} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading your orders…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Purchase History
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          All your course purchases and their status.
        </p>
      </div>

      {!orders || orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
            <ShoppingBag size={22} style={{ color: 'var(--color-text-muted)' }} />
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>No orders yet</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Purchase a course to see it here.</p>
          <Link href="/courses"
            className="mt-1 rounded-xl px-5 py-2 text-sm font-semibold transition-colors hover:opacity-90"
            style={{ background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)' }}>
            Browse courses
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order, i) => {
            const course = asCourse(order)
            const s = STATUS_STYLE[order.status] ?? STATUS_STYLE['pending']!
            const Icon = s.icon
            const charged = formatPrice(order.amount / 100, order.currency)
            const original = order.discountAmount > 0
              ? formatPrice((order.amount + order.discountAmount) / 100, order.currency)
              : null

            return (
              <motion.div key={order.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-4 rounded-2xl bg-[var(--color-bg-surface)] p-4"
                style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>

                {/* Thumbnail */}
                <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded-xl"
                  style={{ background: 'var(--color-bg-subtle)' }}>
                  {course?.thumbnailUrl && (
                    <img src={course.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {course ? (
                    <Link href={`/courses/${course.slug}`}
                      className="text-sm font-bold leading-snug line-clamp-1 hover:underline"
                      style={{ color: 'var(--color-text-primary)' }}>
                      {course.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Course</p>
                  )}
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: s.bg, color: s.color }}>
                      <Icon size={10} />
                      {s.label}
                    </div>
                    {order.stripeInvoiceUrl && (
                      <a href={order.stripeInvoiceUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-[11px] font-semibold hover:underline"
                        style={{ color: '#6366F1' }}>
                        Invoice <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>{charged}</p>
                  {original && (
                    <p className="text-[11px] line-through" style={{ color: 'var(--color-text-muted)' }}>{original}</p>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
