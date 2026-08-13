'use client'

import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { useRatingHistogram } from '@/lib/api/courses'
import Spinner from '@/components/ui/Spinner'

interface Props {
  slug: string
}

export function RatingHistogram({ slug }: Props) {
  const { data, isLoading } = useRatingHistogram(slug)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        <Spinner size={14} />Loading ratings…
      </div>
    )
  }

  if (!data || data.total === 0) {
    return (
      <div className="rounded-2xl p-5 text-center text-sm"
        style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
        No ratings yet. Be the first to leave a review.
      </div>
    )
  }

  const rows: { stars: 1|2|3|4|5; count: number; pct: number }[] = (
    [5, 4, 3, 2, 1] as const
  ).map(stars => {
    const count = data.histogram[String(stars) as '1'|'2'|'3'|'4'|'5'] ?? 0
    return { stars, count, pct: data.total > 0 ? (count / data.total) * 100 : 0 }
  })

  return (
    <div className="rounded-2xl bg-[var(--color-bg-surface)] p-5" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-start gap-6">
        {/* Big average */}
        <div className="flex flex-col items-center text-center">
          <p className="text-4xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            {data.avg.toFixed(1)}
          </p>
          <div className="mt-1 flex">
            {[1,2,3,4,5].map(s => (
              <Star key={s} size={14} fill={s <= Math.round(data.avg) ? '#F59E0B' : 'none'}
                style={{ color: 'var(--color-warning)' }} />
            ))}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {data.total.toLocaleString()} {data.total === 1 ? 'rating' : 'ratings'}
          </p>
        </div>

        {/* Bar chart */}
        <div className="flex-1 space-y-1.5">
          {rows.map(r => (
            <div key={r.stars} className="flex items-center gap-2.5">
              <span className="flex items-center gap-0.5 text-xs font-semibold w-8"
                style={{ color: 'var(--color-text-muted)' }}>
                {r.stars}<Star size={10} fill="#F59E0B" style={{ color: 'var(--color-warning)' }} />
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
                <motion.div className="h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${r.pct}%` }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                  style={{ background: 'var(--color-warning)' }} />
              </div>
              <span className="w-12 text-right text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {r.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
