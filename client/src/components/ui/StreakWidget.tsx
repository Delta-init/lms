'use client'

import { motion } from 'framer-motion'
import { Flame, Target, CalendarDays, Trophy } from 'lucide-react'
import { useMyStreak } from '@/lib/api/streaks'

/* ─────────────────────────────────────────────────────
   Streak & weekly goal — one horizontal band.

   It used to stack three tiny stat clusters above a progress bar inside a
   short card, which left the right two-thirds of a full-width panel empty
   while the numbers themselves were too small to read across the room. The
   metrics now run along the band and the goal takes the space that was going
   to waste, so the card earns its width instead of padding it.
───────────────────────────────────────────────────── */

const ICON_STROKE = 1.75          // matches the global lucide stroke

function Metric({ icon: Icon, value, label, tint, emphasis = false }: {
  icon: React.ElementType
  value: string | number
  label: string
  tint: string
  /** The headline number gets the brand colour and a larger size. */
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${tint}14` }}>
        <Icon size={18} strokeWidth={ICON_STROKE} style={{ color: tint }} />
      </div>
      <div className="min-w-0">
        <p className={`tabular-nums leading-none font-bold ${emphasis ? 'text-[26px]' : 'text-xl'}`}
          style={{ color: emphasis ? tint : 'var(--color-text-primary)' }}>
          {value}
        </p>
        <p className="mt-1 text-xs font-medium leading-none" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </p>
      </div>
    </div>
  )
}

export function StreakWidget() {
  const { data: streak, isLoading } = useMyStreak()

  if (isLoading) {
    return <div className="h-[104px] animate-pulse rounded-2xl"
      style={{ background: 'var(--color-bg-subtle)' }} />
  }

  const current = streak?.currentStreak ?? 0
  const goal    = streak?.weeklyGoal ?? 5
  const done    = streak?.weekProgress ?? 0
  const pct     = Math.min(100, Math.round((done / goal) * 100))
  const hit     = pct >= 100

  return (
    <section
      className="rounded-2xl bg-[var(--color-bg-surface)] px-5 py-4 sm:px-6"
      /* Soft shadow instead of a hard border — depth without a drawn line. */
      style={{ boxShadow: '0 1px 2px rgba(13,15,26,0.04), 0 8px 24px -12px rgba(13,15,26,0.10)' }}>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:gap-8">

        {/* Metrics */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-5 sm:gap-x-9">
          <Metric icon={Flame} value={current} emphasis
            label={current === 1 ? 'Day Streak' : 'Days Streak'}
            tint={current > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
          <Metric icon={Trophy} value={`${streak?.longestStreak ?? 0}d`} label="Personal Best" tint="#F59E0B" />
          <Metric icon={CalendarDays} value={streak?.totalDaysActive ?? 0} label="Total Days" tint="#6366F1" />
        </div>

        {/* Weekly goal — takes the slack on wide screens rather than leaving it */}
        <div className="min-w-0 flex-1 xl:border-l xl:pl-8" style={{ borderColor: 'var(--color-border)' }}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              <Target size={15} strokeWidth={ICON_STROKE} style={{ color: 'var(--color-text-muted)' }} />
              Weekly Goal
            </span>
            <span className="whitespace-nowrap text-sm font-bold tabular-nums"
              style={{ color: hit ? 'var(--color-success)' : 'var(--color-text-primary)' }}>
              {done}<span style={{ color: 'var(--color-text-muted)' }}> / {goal} Lessons</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              style={{ background: hit ? 'var(--color-success)' : 'var(--color-primary)' }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
