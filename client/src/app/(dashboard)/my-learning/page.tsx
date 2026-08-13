'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  BookOpen, Play, Search, CheckCircle2,
} from 'lucide-react'
import { useMyEnrollments, type MyEnrollment } from '@/lib/api/enrollments'
import type { Course } from '@/types/index'
import { StreakWidget } from '@/components/ui/StreakWidget'
import Spinner from '@/components/ui/Spinner'

const STATUS_TABS = ['All Status', 'Not Started', 'In Progress', 'Completed'] as const
type StatusTab = typeof STATUS_TABS[number]

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp  = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } } }

/* When backend populates courseId, it's the full Course object */
function asCourse(e: MyEnrollment): Course | null {
  return typeof e.courseId === 'object' && e.courseId !== null ? e.courseId : null
}

function bucketOf(e: MyEnrollment): 'not_started' | 'in_progress' | 'completed' {
  if (e.status === 'completed' || e.progressPercent >= 100) return 'completed'
  if (e.progressPercent > 0) return 'in_progress'
  return 'not_started'
}

export default function MyLearningPage() {
  const [activeTab, setActiveTab] = useState<StatusTab>('All Status')
  const [search, setSearch] = useState('')

  const { data: enrollments, isLoading } = useMyEnrollments()

  const continuing = useMemo(
    () => (enrollments ?? []).filter(e => bucketOf(e) === 'in_progress').slice(0, 4),
    [enrollments],
  )

  const filtered = useMemo(() => {
    return (enrollments ?? []).filter(e => {
      const course = asCourse(e)
      if (!course) return false
      const bucket = bucketOf(e)
      const matchTab = activeTab === 'All Status'
        || (activeTab === 'Not Started' && bucket === 'not_started')
        || (activeTab === 'In Progress' && bucket === 'in_progress')
        || (activeTab === 'Completed'   && bucket === 'completed')
      const matchSearch = course.title.toLowerCase().includes(search.toLowerCase())
      return matchTab && matchSearch
    })
  }, [enrollments, activeTab, search])

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-3">
        <Spinner size={20} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading your library…</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* ── Streak widget ───────────────────────────── */}
      <StreakWidget />

      {/* ── Continue Learning ───────────────────────── */}
      {continuing.length > 0 && (
        <motion.section variants={stagger} initial="hidden" animate="show">
          <motion.h2 variants={fadeUp} className="mb-4 text-xl font-bold"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Continue Learning
          </motion.h2>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {continuing.map(e => <ContinueCard key={e.id} enrollment={e} />)}
          </div>
        </motion.section>
      )}

      {/* ── All Materials ───────────────────────────── */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            All Materials
            <span className="ml-2 inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-sm font-bold"
              style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
              {enrollments?.length ?? 0}
            </span>
          </h2>

          <div className="flex items-center gap-2 flex-1 sm:flex-none">
            <div className="relative flex-1 sm:flex-none">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-xl py-2 pl-9 pr-4 text-sm outline-none sm:w-44"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
            </div>
          </div>
        </div>

        <div className="mb-5 flex items-center gap-1 rounded-2xl p-1 overflow-x-auto scrollbar-none" style={{ background: 'var(--color-bg-subtle)' }}>
          {STATUS_TABS.map(tab => (
            <motion.button key={tab} onClick={() => setActiveTab(tab)}
              className="relative flex-shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap"
              style={{ color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
              {activeTab === tab && (
                <motion.div layoutId="my-learning-tab"
                  className="absolute inset-0 rounded-xl bg-[var(--color-bg-surface)]"
                  style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
              )}
              <span className="relative z-10">{tab}</span>
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {filtered.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
                style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
                <BookOpen size={22} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {(enrollments?.length ?? 0) === 0 ? "You haven't enrolled yet" : 'No materials match'}
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {(enrollments?.length ?? 0) === 0
                  ? 'Browse the catalogue and pick something that sparks your interest.'
                  : 'Try a different filter or search term.'}
              </p>
              {(enrollments?.length ?? 0) === 0 && (
                <Link href="/courses" className="mt-1 rounded-xl px-5 py-2 text-sm font-semibold transition-colors hover:opacity-90"
                  style={{ background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)' }}>
                  Browse courses
                </Link>
              )}
            </motion.div>
          ) : (
            <motion.div key="grid"
              variants={stagger} initial="hidden" animate="show"
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map(e => <EnrollmentCard key={e.id} enrollment={e} />)}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  )
}

/* ─── Cards ─────────────────────────────────────── */

function ContinueCard({ enrollment }: { enrollment: MyEnrollment }) {
  const course = asCourse(enrollment)
  if (!course) return null
  const href = enrollment.lastLessonId
    ? `/learn/${course.slug}/${enrollment.lastLessonId}`
    : `/courses/${course.slug}`
  return (
    <motion.div variants={fadeUp}
      whileHover={{ y: -4, boxShadow: '0 20px 48px rgba(0,0,0,0.10)' }}
      className="group overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] transition-all"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="relative h-40 w-full flex-shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-32">
          {course.thumbnailUrl
            ? <img src={course.thumbnailUrl} alt={course.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            : <div className="flex h-full w-full items-center justify-center" style={{ background: 'var(--color-bg-subtle)' }}>
                <BookOpen size={26} style={{ color: 'var(--color-text-muted)' }} />
              </div>}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(17,24,39,0.4)' }}>
            <div className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: 'rgba(0,87,184,0.92)', boxShadow: '0 6px 16px rgba(0,87,184,0.4)' }}>
              <Play size={14} fill="white" color="white" />
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'var(--color-primary-light)', color: '#2563EB' }}>Course</span>
          <h3 className="mt-1.5 text-sm font-bold leading-snug line-clamp-2" style={{ color: 'var(--color-text-primary)' }}>
            {course.title}
          </h3>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Progress: <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{enrollment.progressPercent}%</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
              <motion.div className="h-full rounded-full" style={{ background: 'var(--color-success)' }}
                initial={{ width: 0 }} animate={{ width: `${enrollment.progressPercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }} />
            </div>
          </div>
          <Link href={href}>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              className="mt-3 rounded-xl px-4 py-1.5 text-xs font-bold text-white"
              style={{ background: 'var(--color-text-primary)' }}>
              Continue
            </motion.button>
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

function EnrollmentCard({ enrollment }: { enrollment: MyEnrollment }) {
  const course = asCourse(enrollment)
  if (!course) return null
  const bucket = bucketOf(enrollment)
  const isDone   = bucket === 'completed'
  const inProg   = bucket === 'in_progress'
  const playHref = enrollment.lastLessonId
    ? `/learn/${course.slug}/${enrollment.lastLessonId}`
    : `/courses/${course.slug}`

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 26 } } }}
      whileHover={{ y: -4, boxShadow: '0 20px 44px rgba(0,0,0,0.10)' }}
      className="group overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] cursor-pointer"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
      <Link href={playHref}>
        <div className="relative h-40 overflow-hidden">
          {course.thumbnailUrl
            ? <img src={course.thumbnailUrl} alt={course.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            : <div className="flex h-full w-full items-center justify-center" style={{ background: 'var(--color-bg-subtle)' }}>
                <BookOpen size={32} style={{ color: 'var(--color-text-muted)' }} />
              </div>}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            style={{ background: 'rgba(17,24,39,0.35)' }}>
            <div className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: 'rgba(0,87,184,0.92)', boxShadow: '0 6px 16px rgba(0,87,184,0.4)' }}>
              <Play size={14} fill="white" color="white" />
            </div>
          </div>
          {isDone && (
            <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: 'var(--color-success)' }}>
              <CheckCircle2 size={16} color="white" />
            </div>
          )}
        </div>
        <div className="p-4">
          <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'var(--color-primary-light)', color: '#2563EB' }}>Course</span>
          <h3 className="mt-1.5 line-clamp-2 text-sm font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
            {course.title}
          </h3>
          <div className="mt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
            {inProg ? (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
                  <motion.div className="h-full rounded-full" style={{ background: 'var(--color-success)', width: `${enrollment.progressPercent}%` }} />
                </div>
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{enrollment.progressPercent}%</span>
              </div>
            ) : isDone ? (
              <span className="text-xs font-semibold" style={{ color: 'var(--color-success)' }}>Completed ✓</span>
            ) : (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Not Started</span>
            )}
            <span className="rounded-xl px-3.5 py-1.5 text-xs font-bold"
              style={inProg
                ? { background: 'var(--color-text-primary)', color: 'var(--color-text-inverse)' }
                : isDone
                  ? { background: 'transparent', color: 'var(--color-success)', border: '1.5px solid #BBF7D0' }
                  : { background: 'transparent', color: 'var(--color-text-primary)', border: '1.5px solid var(--color-border-strong)' }}>
              {inProg ? 'Continue' : isDone ? 'Review' : 'Start'}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
