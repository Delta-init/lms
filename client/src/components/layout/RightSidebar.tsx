'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ListChecks, Activity, Clock, CheckCircle2, Play,
  Flame, X, ChevronRight, Sparkles, BookOpen,
  Trophy, Target, Video, Radio, Calendar, ArrowUpRight,
  TrendingUp, Zap,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { useMyEnrollments, useMyActivity, type MyEnrollment, type ActivityItem } from '@/lib/api/enrollments'
import { useUpcomingLiveClasses, isLive, type LiveClass } from '@/lib/api/liveClasses'
import { useUIStore } from '@/store/ui.store'
import Spinner from '@/components/ui/Spinner'

/* ── Helpers ──────────────────────────────────────────── */
function fmtMins(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60); const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`
}
function asCourse(e: MyEnrollment) {
  return typeof e.courseId === 'object' && e.courseId !== null ? e.courseId : null
}
function activityCourse(a: ActivityItem) {
  return typeof a.courseId === 'object' && a.courseId !== null ? a.courseId : null
}
function activityLesson(a: ActivityItem) {
  return typeof a.lessonId === 'object' && a.lessonId !== null ? a.lessonId : null
}

/* ── Section header ─────────────────────────────────── */
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <div className="flex h-4 w-4 items-center justify-center rounded-md"
        style={{ background: 'rgba(0,87,184,0.10)' }}>
        <Icon size={9} style={{ color: 'var(--color-primary)' }} />
      </div>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: 'var(--color-text-muted)' }}>{title}</h3>
    </div>
  )
}

/* Hairline separator between sidebar sections. Uses the border token so it
   stays a whisper in both themes — as a literal light grey it rendered as a
   bright white rule across the dark sidebar. */
function Divider() {
  return <div className="h-px" style={{ background: 'var(--color-border)' }} />
}

/* ─────────────────────────────────────────────────────
   RIGHT SIDEBAR
───────────────────────────────────────────────────── */
export function RightSidebar() {
  const { rightPanelOpen, setRightPanel } = useUIStore()
  const { data: user }         = useCurrentUser()
  const { data: enrollments }  = useMyEnrollments()
  const { data: activity }     = useMyActivity(6)
  const { data: upcomingLive } = useUpcomingLiveClasses(4)

  const todos = useMemo(() => {
    if (!enrollments) return []
    const items: Array<{
      kind: 'continue' | 'start'
      course: NonNullable<ReturnType<typeof asCourse>>
      enrollment: MyEnrollment
    }> = []
    for (const e of enrollments) {
      const c = asCourse(e)
      if (!c) continue
      if (e.status === 'completed' || e.progressPercent >= 100) continue
      items.push(e.progressPercent > 0
        ? { kind: 'continue', course: c, enrollment: e }
        : { kind: 'start',   course: c, enrollment: e })
    }
    items.sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'continue' ? -1 : 1)
    return items.slice(0, 4)
  }, [enrollments])

  const stats = useMemo(() => {
    if (!enrollments) return { active: 0, completed: 0 }
    return {
      active:    enrollments.filter(e => e.status !== 'completed' && (e.progressPercent ?? 0) < 100).length,
      completed: enrollments.filter(e => e.status === 'completed' || (e.progressPercent ?? 0) >= 100).length,
    }
  }, [enrollments])

  const avatarInitial  = (user?.name?.trim()?.[0] ?? '?').toUpperCase()
  const hasAvatarImage = !!user?.avatarUrl
  const weekLessons    = activity?.week.lessonsCompleted ?? 0
  const weekMins       = activity?.week.minutesWatched   ?? 0

  return (
    <AnimatePresence>
      {rightPanelOpen && (
        <>
          {/* Mobile backdrop */}
          <motion.div
            key="right-backdrop"
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setRightPanel(false)}
          />

          {/* Panel */}
          <motion.aside
            key="right-panel"
            initial={{ x: 340, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 340, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 z-30 flex h-screen w-[min(320px,100vw)] flex-col lg:top-[100px] lg:h-[calc(100vh-100px)] lg:z-20"
            style={{
              background: 'var(--color-bg-inset)',
              borderLeft: '1px solid var(--color-border)',
              boxShadow: '-6px 0 20px rgba(13,15,26,0.05)',
            }}>

            {/* Scrollable area */}
            <div className="flex flex-col gap-0 overflow-y-auto scrollbar-none">

              {/* ── Profile card ─────────────────────── */}
              <div
                className="m-3 rounded-2xl p-3.5"
                style={{
                  background: 'var(--color-bg-surface)',
                  border: '1px solid rgba(0,87,184,0.14)',
                }}>
                {/* Close */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="relative flex-shrink-0">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white"
                        style={{ background: 'var(--color-primary)', boxShadow: '0 2px 8px rgba(0,87,184,0.20)' }}>
                        {hasAvatarImage
                          ? <img src={user!.avatarUrl} alt="" className="h-full w-full object-cover" />
                          : avatarInitial}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white"
                        style={{ background: 'var(--color-success)' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                        {user?.name ?? '—'}
                      </p>
                      <p className="truncate text-[11px] leading-tight mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {user?.headline ?? (user?.role ? user.role[0]!.toUpperCase() + user.role.slice(1) : 'Student')}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setRightPanel(false)} aria-label="Close"
                    className="ml-2 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bg-surface)]/80"
                    style={{ color: '#C4C9D4' }}>
                    <X size={11} />
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-1.5">
                  <StatPill icon={Target}  value={stats.active}    label="Active"     color="#0057b8" bg="rgba(0,87,184,0.08)" />
                  <StatPill icon={Trophy}  value={stats.completed} label="Done"       color="#22C55E" bg="rgba(34,197,94,0.08)"  />
                  <StatPill icon={Flame}   value={weekLessons}     label="This week"  color="#F59E0B" bg="rgba(245,158,11,0.08)" />
                </div>
              </div>

              <Divider />

              {/* ── Upcoming live ────────────────────── */}
              {upcomingLive && upcomingLive.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-2">
                    <SectionHeader icon={Video} title="Live classes" />
                    <div className="space-y-1">
                      {upcomingLive.slice(0, 3).map((l, i) => <LiveRow key={l.id} live={l} index={i} />)}
                    </div>
                  </div>
                  <Divider />
                </>
              )}

              {/* ── Today's plan ─────────────────────── */}
              <div className="px-3 pt-3 pb-2">
                <SectionHeader icon={ListChecks} title="Today's plan" />
                {!enrollments && (
                  <div className="flex items-center gap-1.5 py-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <Spinner size={10} />Loading…
                  </div>
                )}
                {enrollments && todos.length === 0 && (
                  <div className="rounded-xl px-3 py-2 text-xs"
                    style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                    Nothing queued.{' '}
                    <Link href="/courses" className="font-semibold" style={{ color: 'var(--color-primary)' }}>Browse →</Link>
                  </div>
                )}
                <div className="space-y-1">
                  {todos.map((t) => {
                    const href = t.enrollment.lastLessonId
                      ? `/learn/${t.course.slug}/${t.enrollment.lastLessonId}`
                      : `/courses/${t.course.slug}`
                    return (
                      <Link key={t.enrollment.id} href={href}>
                        <div className="group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-all hover:bg-[var(--color-hover)]"
                          style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)' }}>
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                            style={{
                              background: t.kind === 'continue' ? 'rgba(0,87,184,0.08)' : 'var(--color-bg-page)',
                              border: t.kind === 'continue' ? '1px solid rgba(0,87,184,0.16)' : '1px solid var(--color-border)',
                            }}>
                            {t.kind === 'continue'
                              ? <Play size={9} fill="#0057b8" color="#0057b8" />
                              : <Sparkles size={9} style={{ color: 'var(--color-text-muted)' }} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                              {t.kind === 'continue' ? 'Continue' : 'Start'}{' '}{t.course.title}
                            </p>
                            {t.kind === 'continue' && (
                              <div className="mt-1 flex items-center gap-1.5">
                                <div className="h-1 flex-1 rounded-full" style={{ background: 'var(--color-border)' }}>
                                  <div className="h-full rounded-full"
                                    style={{ background: 'var(--color-success)', width: `${t.enrollment.progressPercent}%` }} />
                                </div>
                                <span className="text-[10px] font-bold tabular-nums" style={{ color: 'var(--color-success)' }}>
                                  {t.enrollment.progressPercent}%
                                </span>
                              </div>
                            )}
                          </div>
                          <ChevronRight size={10} className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                            style={{ color: 'var(--color-primary)' }} />
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>

              <Divider />

              {/* ── Recent activity ──────────────────── */}
              <div className="px-3 pt-3 pb-2">
                <SectionHeader icon={Activity} title="Recent activity" />
                {!activity && (
                  <div className="flex items-center gap-1.5 py-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <Spinner size={10} />Loading…
                  </div>
                )}
                {activity && activity.items.length === 0 && (
                  <div className="rounded-xl px-3 py-2 text-xs"
                    style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                    Mark a lesson complete and it&apos;ll show up here.
                  </div>
                )}
                <div className="space-y-2.5">
                  {activity?.items.map((a) => {
                    const c = activityCourse(a)
                    const l = activityLesson(a)
                    return (
                      <div key={a.id} className="flex items-start gap-2">
                        <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.16)' }}>
                          <CheckCircle2 size={10} style={{ color: 'var(--color-success)' }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-xs leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>Completed </span>
                            <span className="font-semibold">{l?.title ?? 'a lesson'}</span>
                          </p>
                          {c && (
                            <Link href={`/courses/${c.slug}`}
                              className="mt-0.5 block line-clamp-1 text-[10px] transition-colors hover:text-[#0057b8]"
                              style={{ color: 'var(--color-text-muted)' }}>
                              {c.title}
                            </Link>
                          )}
                          <p className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                            <Clock size={8} />{relTime(a.completedAt ?? a.updatedAt)}
                            {l && l.durationMins > 0 && <> · {fmtMins(l.durationMins)}</>}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Week summary ─────────────────────── */}
              {activity && (weekLessons > 0 || weekMins > 0) && (
                <>
                  <Divider />
                  {/* Fixed brand-blue card so white text keeps its contrast in
                      BOTH themes — the old `var(--color-text-primary)` background
                      flipped to near-white in dark mode and hid the text. */}
                  <div className="mx-3 mt-3 mb-2 rounded-2xl p-3.5" style={{ background: 'linear-gradient(135deg, #0057b8, #003d80)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Flame size={10} style={{ color: 'rgba(255,255,255,0.9)' }} />
                          <span className="text-[9px] font-bold uppercase tracking-[0.09em]"
                            style={{ color: 'rgba(255,255,255,0.6)' }}>This week</span>
                        </div>
                        <p className="text-xl font-bold text-white leading-none">
                          {weekLessons}
                          <span className="ml-1 text-sm font-normal" style={{ color: 'rgba(255,255,255,0.65)' }}>
                            lesson{weekLessons === 1 ? '' : 's'}
                          </span>
                        </p>
                        {weekMins > 0 && (
                          <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
                            {fmtMins(weekMins)} watched
                          </p>
                        )}
                      </div>
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }}>
                        <TrendingUp size={13} style={{ color: '#fff' }} />
                      </div>
                    </div>
                    <p className="mt-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      Keep the streak going. Next lesson is waiting.
                    </p>
                  </div>
                </>
              )}

              <Divider />

              {/* ── Quick links ──────────────────────── */}
              <div className="px-3 pt-3 pb-4">
                <SectionHeader icon={BookOpen} title="Quick links" />
                <div className="grid grid-cols-2 gap-1">
                  <QuickTile href="/my-learning" label="My library" icon={BookOpen} />
                  <QuickTile href="/courses"     label="Browse"    icon={Sparkles} />
                  <QuickTile href="/favorites"   label="Saved"     icon={Trophy}   />
                  <QuickTile href="/settings"    label="Settings"  icon={Target}   />
                </div>
              </div>

            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

/* ── Sub-components ─────────────────────────────────── */
function StatPill({ icon: Icon, value, label, color, bg }: {
  icon: React.ElementType; value: number; label: string; color: string; bg: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl p-2"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-1">
        <div className="flex h-4 w-4 items-center justify-center rounded-md" style={{ background: bg }}>
          <Icon size={8} style={{ color }} />
        </div>
        <span className="text-sm font-bold leading-none" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
      </div>
      <p className="text-[9px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
    </div>
  )
}

function LiveRow({ live, index }: { live: LiveClass; index: number }) {
  const liveNow = isLive(live)
  const course  = typeof live.course === 'object' ? live.course : null
  const when    = new Date(live.scheduledStart).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return (
    <a href={live.meetingUrl} target="_blank" rel="noreferrer noopener"
      className="group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-all hover:bg-[var(--color-hover)]"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)' }}>
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: liveNow ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.08)',
          border: `1px solid ${liveNow ? 'rgba(239,68,68,0.18)' : 'rgba(99,102,241,0.14)'}`,
        }}>
        {liveNow
          ? <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
              <Radio size={10} style={{ color: 'var(--color-danger)' }} />
            </motion.div>
          : <Calendar size={10} style={{ color: '#6366F1' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{live.title}</p>
        <p className="mt-0.5 text-[10px] leading-tight" style={{ color: 'var(--color-text-muted)' }}>
          {liveNow
            ? <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>● LIVE NOW</span>
            : <>{when}{course && ` · ${course.title}`}</>}
        </p>
      </div>
      <ArrowUpRight size={9} className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
        style={{ color: liveNow ? '#EF4444' : '#6366F1' }} />
    </a>
  )
}

function QuickTile({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
  return (
    <Link href={href}>
      {/* Theme tokens, not literals: a hardcoded light grey reads as a near-white
          1px outline on the dark page (17:1 contrast) while every other border
          sits near 2:1. Hover steps up to `-strong`, which is the more
          prominent value in BOTH themes — the literal version inverted in dark,
          getting *darker* on hover. */}
      <div className="group flex items-center gap-1.5 rounded-xl px-2.5 py-2 transition-all hover:bg-[var(--color-bg-surface)]"
        style={{ border: '1px solid var(--color-border)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)' }}>
        <Icon size={11} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      </div>
    </Link>
  )
}

/* ── Floating toggle ───────────────────────────────── */
export function RightSidebarToggle() {
  const { rightPanelOpen, setRightPanel } = useUIStore()
  if (rightPanelOpen) return null
  return (
    <motion.button
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={() => setRightPanel(true)}
      aria-label="Show activity panel"
      className="fixed right-4 bottom-6 z-20 flex h-10 w-10 items-center justify-center rounded-full transition-shadow hover:shadow-xl lg:bottom-auto lg:top-[120px]"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 14px rgba(0,0,0,0.10)' }}>
      <Zap size={15} style={{ color: 'var(--color-primary)' }} />
    </motion.button>
  )
}
