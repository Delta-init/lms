'use client'

import { motion } from 'framer-motion'
import {
  Sparkles, Clock, Target, ListChecks, AlertCircle,
  BookOpen, Lightbulb,
} from 'lucide-react'
import { useAINotes } from '@/lib/api/aiNotes'
import Spinner from '@/components/ui/Spinner'

function fmtMins(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const DIFFICULTY_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  beginner:     { text: '#10B981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.25)' },
  intermediate: { text: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' },
  advanced:     { text: '#EF4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.25)'  },
  mixed:        { text: '#6366F1', bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.25)' },
}

export function AINotesPanel({ slug }: { slug: string }) {
  const { data: notes, isLoading, isError } = useAINotes(slug)

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.22, type: 'spring', stiffness: 260, damping: 26 }}
      className="mt-8 overflow-hidden rounded-2xl"
      style={{
        background: 'rgba(0,87,184,0.05)',
        border: '1px solid rgba(0,87,184,0.15)',
      }}>

      {/* ── Header ───────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid rgba(0,87,184,0.10)' }}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(0,87,184,0.12)', border: '1px solid rgba(0,87,184,0.25)' }}>
            <Sparkles size={16} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              AI Study Notes
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              Generated from this course&apos;s content
            </p>
          </div>
        </div>

        {notes?.difficulty && (() => {
          const s = DIFFICULTY_STYLE[notes.difficulty] ?? DIFFICULTY_STYLE['mixed']!
          return (
            <span className="rounded-lg px-2.5 py-1 text-[11px] font-bold capitalize"
              style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
              {notes.difficulty}
            </span>
          )
        })()}
      </div>

      {/* ── Body ─────────────────────────────────────── */}
      <div className="p-5">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <Spinner size={14} />
            Crafting your study notes…
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.18)' }}>
            <AlertCircle size={14} />Couldn&apos;t load AI notes for this course.
          </div>
        )}

        {notes && (
          <div className="space-y-6">
            {/* Summary */}
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {notes.summary}
            </p>

            {/* Estimated time + topics */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 rounded-xl px-3 py-1.5"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
                <Clock size={13} style={{ color: 'var(--color-primary)' }} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{notes.estimatedStudyTime}</span> recommended
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-xl px-3 py-1.5"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
                <BookOpen size={13} style={{ color: '#2F6BFF' }} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{notes.studyOrder.length} sections</span>
                </span>
              </div>
            </div>

            {/* Key topics */}
            {notes.keyTopics.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Target size={13} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                    Key topics
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {notes.keyTopics.map(t => (
                    <span key={t} className="rounded-lg px-2.5 py-1 text-xs font-medium"
                      style={{ background: 'rgba(0,87,184,0.08)', color: 'var(--color-primary)', border: '1px solid rgba(0,87,184,0.16)' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Study order */}
            {notes.studyOrder.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-1.5">
                  <ListChecks size={13} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                    Suggested study order
                  </span>
                </div>
                <ol className="space-y-2.5">
                  {notes.studyOrder.map((s, i) => (
                    <motion.li key={s.title}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 + i * 0.04 }}
                      className="flex gap-3 rounded-xl bg-[var(--color-bg-surface)] p-3"
                      style={{ border: '1px solid var(--color-border)' }}>
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                        style={{ background: 'rgba(0,87,184,0.10)', color: 'var(--color-primary)' }}>{i + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.title}</p>
                          {s.minutes > 0 && (
                            <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{fmtMins(s.minutes)}</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{s.tip}</p>
                      </div>
                    </motion.li>
                  ))}
                </ol>
              </div>
            )}

            {/* Key takeaways */}
            {notes.keyTakeaways.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-1.5">
                  <Lightbulb size={13} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                    What you&apos;ll walk away with
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {notes.keyTakeaways.map((t, i) => (
                    <motion.li key={i}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.04 }}
                      className="flex items-start gap-2 text-sm leading-relaxed"
                      style={{ color: 'var(--color-text-secondary)' }}>
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: 'var(--color-primary)' }} />
                      {t}
                    </motion.li>
                  ))}
                </ul>
              </div>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-[11px]"
              style={{ borderTop: '1px solid rgba(0,87,184,0.10)', color: 'var(--color-text-muted)' }}>
              <span>Generated {new Date(notes.generatedAt).toLocaleString()}</span>
              <span className="font-mono">{notes.generator}</span>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  )
}
