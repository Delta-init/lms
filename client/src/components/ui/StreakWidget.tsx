'use client'

import { motion } from 'framer-motion'
import { Flame, Target, Calendar, Trophy } from 'lucide-react'
import { useMyStreak } from '@/lib/api/streaks'

export function StreakWidget() {
  const { data: streak, isLoading } = useMyStreak()

  if (isLoading) {
    return (
      <div className="h-[120px] animate-pulse rounded-2xl" style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }} />
    )
  }

  const current = streak?.currentStreak ?? 0
  const goal    = streak?.weeklyGoal ?? 5
  const done    = streak?.weekProgress ?? 0
  const pct     = Math.min(100, Math.round((done / goal) * 100))

  return (
    <div className="rounded-2xl bg-[var(--color-bg-surface)] p-4" style={{ border: '1px solid var(--color-border)' }}>
      <div className="mb-3 flex items-center gap-1.5">
        <Flame size={13} style={{ color: 'var(--color-primary)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
          Your streak
        </span>
      </div>

      <div className="flex items-center gap-4 mb-3">
        {/* Current streak */}
        <div className="flex items-center gap-1.5">
          <span className="text-3xl font-bold tabular-nums" style={{ color: current > 0 ? '#0057b8' : 'var(--color-text-muted)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            {current}
          </span>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>day{current !== 1 ? 's' : ''}</p>
            <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>current</p>
          </div>
        </div>

        <div className="h-8 w-px" style={{ background: 'var(--color-bg-muted)' }} />

        {/* Longest */}
        <div className="flex items-center gap-1.5">
          <Trophy size={13} style={{ color: 'var(--color-warning)' }} />
          <div>
            <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {streak?.longestStreak ?? 0}d
            </p>
            <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>best</p>
          </div>
        </div>

        <div className="h-8 w-px" style={{ background: 'var(--color-bg-muted)' }} />

        {/* Total */}
        <div className="flex items-center gap-1.5">
          <Calendar size={13} style={{ color: '#6366F1' }} />
          <div>
            <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {streak?.totalDaysActive ?? 0}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>total days</p>
          </div>
        </div>
      </div>

      {/* Weekly goal */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <Target size={10} />Weekly goal
          </span>
          <span className="font-semibold" style={{ color: pct >= 100 ? '#22C55E' : 'var(--color-text-primary)' }}>
            {done}/{goal} lessons
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
          <motion.div
            className="h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{ background: pct >= 100 ? '#22C55E' : '#0057b8' }}
          />
        </div>
      </div>
    </div>
  )
}
