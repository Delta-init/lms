'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Video, Radio, Clock, AlertCircle, Lock } from 'lucide-react'
import Link from 'next/link'
import { Tv2 } from 'lucide-react'
import { useLiveClassesForCourse, isLive, isUpcoming, fmtCountdown, type LiveClass } from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour:    'numeric', minute: '2-digit',
  })
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}


export function LiveClassesPanel({ slug, isEnrolled }: { slug: string; isEnrolled: boolean }) {
  const { data: items, isLoading, isError } = useLiveClassesForCourse(slug)
  /* Tick every 30s so live/upcoming/countdown flip in real time */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const upcoming = items?.filter(l => isLive(l) || isUpcoming(l)) ?? []
  /* Show at most 4 by default — full list is a follow-up. */
  const visible = upcoming.slice(0, 4)

  if (!isLoading && !isError && visible.length === 0) {
    /* Empty state — don't clutter the page if there's nothing to show. */
    return null
  }

  /* Use isEnrolled from props; backend also annotates it on each item */
  const enrolled = isEnrolled || (items?.some(l => (l as any).isEnrolled) ?? false)

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, type: 'spring', stiffness: 260, damping: 26 }}
      className="mt-8 overflow-hidden rounded-2xl"
      style={{
        background: 'rgba(0,87,184,0.05)',
        border: '1px solid rgba(99,102,241,0.18)',
      }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
            <Video size={16} style={{ color: '#6366F1' }} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Live classes
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              Scheduled real-time sessions with the instructor
            </p>
          </div>
        </div>
        {enrolled && (
          <Link href="/live-classes"
            className="text-xs font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-primary)' }}>
            View all →
          </Link>
        )}
      </div>

      <div className="p-5">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <Spinner size={14} />Loading…
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.18)' }}>
            <AlertCircle size={14} />Couldn&apos;t load scheduled sessions.
          </div>
        )}

        <div className="space-y-3">
          {visible.map((l, i) => <LiveClassRow key={l.id} live={l} now={now} index={i} isEnrolled={enrolled} />)}
        </div>

        {!enrolled && visible.length > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-xs"
            style={{ background: 'rgba(0,87,184,0.06)', border: '1px solid rgba(0,87,184,0.14)', color: 'var(--color-primary)' }}>
            <Lock size={12} />
            Enroll in this course to access live sessions. Join links are sent via email after booking.
          </div>
        )}
      </div>
    </motion.section>
  )
}

function LiveClassRow({ live, now, index, isEnrolled }: { live: LiveClass; now: number; index: number; isEnrolled: boolean }) {
  const isLiveNow  = isLive(live)
  const isInternal = live.type === 'internal'
  const countdown  = fmtCountdown(live.scheduledStart, now)

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + index * 0.04 }}
      className="flex items-center gap-4 rounded-xl bg-[var(--color-bg-surface)] p-3.5"
      style={{ border: `1px solid ${isLiveNow ? 'rgba(239,68,68,0.30)' : 'var(--color-border)'}` }}>

      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
        style={{
          background: isLiveNow ? 'rgba(239,68,68,0.10)' : isInternal ? 'rgba(0,87,184,0.08)' : 'rgba(99,102,241,0.08)',
          border: `1px solid ${isLiveNow ? 'rgba(239,68,68,0.25)' : isInternal ? 'rgba(0,87,184,0.18)' : 'rgba(99,102,241,0.18)'}`,
        }}>
        {isLiveNow
          ? <Radio size={18} style={{ color: 'var(--color-danger)' }} />
          : isInternal
          ? <Tv2 size={18} style={{ color: 'var(--color-primary)' }} />
          : <Calendar size={18} style={{ color: '#6366F1' }} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isLiveNow && (
            <motion.span
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white"
              style={{ background: 'var(--color-danger)' }}>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-bg-surface)]" />Live now
            </motion.span>
          )}
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{live.title}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          <span className="flex items-center gap-1"><Calendar size={10} />{fmtDateTime(live.scheduledStart)}</span>
          <span style={{ color: 'var(--color-border)' }}>·</span>
          <span className="flex items-center gap-1"><Clock size={10} />{fmtDuration(live.durationMins)}</span>
          {!isLiveNow && <>
            <span style={{ color: 'var(--color-border)' }}>·</span>
            <span style={{ color: 'var(--color-primary)' }}>{countdown}</span>
          </>}
        </div>
      </div>

      {/* CTA — gated by enrollment. Links are never exposed directly; students receive them via email. */}
      {isEnrolled ? (
        isInternal ? (
          /* Internal Mux stream — /watch endpoint enforces enrollment server-side */
          <Link href={`/live-classes/${live.id}/watch`}
            className="shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold text-white transition-all"
            style={isLiveNow
              ? { background: 'var(--color-danger)', boxShadow: '0 4px 16px rgba(239,68,68,0.32)' }
              : { background: 'var(--color-primary)' }}>
            {isLiveNow ? 'Watch now' : 'View'}
          </Link>
        ) : (
          /* External session — redirect to schedule page, join link comes via email */
          <Link href="/live-classes"
            className="shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition-all"
            style={{ background: 'rgba(99,102,241,0.10)', color: '#6366F1', border: '1px solid rgba(99,102,241,0.25)' }}>
            View schedule
          </Link>
        )
      ) : (
        /* Not enrolled — show lock; no URL exposed */
        <div className="shrink-0 flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold"
          style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
          <Lock size={11} />Enroll
        </div>
      )}
    </motion.div>
  )
}
