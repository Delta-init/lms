'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Send, CheckCircle, Clock, Award, ChevronDown, ChevronUp } from 'lucide-react'
import { useSessionHomework, useSubmitHomework, type Homework } from '@/lib/api/homework'
import Spinner from '@/components/ui/Spinner'

interface Props {
  sessionId: string
}

function statusBadge(status?: string, grade?: number) {
  if (!status) return null
  const map: Record<string, { label: string; color: string; bg: string }> = {
    submitted: { label: 'Submitted', color: 'var(--color-warning)', bg: 'rgba(245,158,11,0.10)' },
    graded:    { label: grade !== undefined ? `Graded: ${grade}/100` : 'Graded', color: 'var(--color-success)', bg: 'rgba(16,185,129,0.10)' },
    returned:  { label: 'Returned', color: '#6366F1', bg: 'rgba(99,102,241,0.10)' },
  }
  const s = map[status] ?? { label: status, color: 'var(--color-text-muted)', bg: 'var(--color-bg-subtle)' }
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function HomeworkCard({ hw, sessionId }: { hw: Homework; sessionId: string }) {
  const [open,           setOpen]           = useState(false)
  const [submissionText, setSubmissionText] = useState('')
  const [submissionUrl,  setSubmissionUrl]  = useState('')
  const [submitted,      setSubmitted]      = useState(false)

  const submitMutation = useSubmitHomework(sessionId)

  const inputBase = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white'

  const handleSubmit = async () => {
    if (!submissionText.trim() && !submissionUrl.trim()) return
    await submitMutation.mutateAsync({
      homeworkId: hw.id,
      submissionText: submissionText.trim() || undefined,
      submissionUrl:  submissionUrl.trim()  || undefined,
    })
    setSubmitted(true)
    setOpen(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-[var(--color-bg-surface)] dark:bg-gray-900 overflow-hidden border border-[var(--color-border)] dark:border-gray-700">
      <div
        className="flex items-start justify-between gap-3 p-4 cursor-pointer hover:bg-[var(--color-bg-muted)] dark:hover:bg-gray-800/50"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="mt-0.5 rounded-lg p-1.5 flex-shrink-0" style={{ background: 'rgba(0,87,184,0.10)' }}>
            <BookOpen size={14} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--color-text-primary)] dark:text-white">{hw.title}</p>
            {hw.dueDate && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                <Clock size={10} />Due {new Date(hw.dueDate).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {submitted && statusBadge('submitted')}
          {open ? <ChevronUp size={14} className="text-[var(--color-text-muted)]" /> : <ChevronDown size={14} className="text-[var(--color-text-muted)]" />}
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-[var(--color-border)] dark:border-gray-700 overflow-hidden">
            <div className="p-4 space-y-3">
              {hw.description && (
                <p className="text-sm text-[var(--color-text-secondary)] dark:text-[var(--color-text-muted)] whitespace-pre-wrap">{hw.description}</p>
              )}
              {submitted ? (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-success)' }}>
                  <CheckCircle size={14} />Submission received!
                </div>
              ) : (
                <>
                  <textarea
                    className={inputBase}
                    rows={4}
                    placeholder="Write your answer here…"
                    value={submissionText}
                    onChange={e => setSubmissionText(e.target.value)}
                  />
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)]">or URL:</span>
                    <input
                      className={`${inputBase} pl-12`}
                      placeholder="https://…"
                      value={submissionUrl}
                      onChange={e => setSubmissionUrl(e.target.value)}
                    />
                  </div>
                  <button
                    disabled={(!submissionText.trim() && !submissionUrl.trim()) || submitMutation.isPending}
                    onClick={handleSubmit}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                    style={{ background: 'var(--color-primary)' }}>
                    {submitMutation.isPending
                      ? <Spinner size={13} />
                      : <Send size={13} />}
                    Submit
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function SessionHomework({ sessionId }: Props) {
  const { data, isLoading } = useSessionHomework(sessionId)
  const list = Array.isArray(data) ? data : []

  if (isLoading) {
    return (
      <div className="flex h-20 items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
        <Spinner size={14} />Loading homework…
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-border)] dark:border-gray-700 p-6 text-center">
        <BookOpen size={22} className="mx-auto mb-2 text-[var(--color-text-muted)]" />
        <p className="text-sm text-[var(--color-text-muted)]">No homework assigned for this session</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen size={15} style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-bold text-[var(--color-text-primary)] dark:text-white">
          Homework ({list.length})
        </h3>
      </div>
      {list.map(hw => (
        <HomeworkCard key={hw.id} hw={hw} sessionId={sessionId} />
      ))}
    </div>
  )
}
