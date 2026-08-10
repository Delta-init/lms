'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardList, CheckCircle2, XCircle, Clock, AlertTriangle, FileText,
  Image as ImageIcon, Search, User, BookOpen, Layers, Calendar, RotateCcw,
} from 'lucide-react'
import {
  useReviewQueue, useReviewAssignment,
  type ReviewAssignment, type ClassAssignmentStatus,
} from '@/lib/api/classAssignments'
import { useToast } from '@/store/ui.store'

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
function fmtDateTime(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STATUS: Record<ClassAssignmentStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  pending:  { label: 'Awaiting review', color: '#B45309', bg: 'rgba(245,158,11,0.10)', Icon: Clock },
  approved: { label: 'Approved',        color: '#059669', bg: 'rgba(16,185,129,0.10)', Icon: CheckCircle2 },
  rejected: { label: 'Sent back',       color: '#DC2626', bg: 'rgba(239,68,68,0.10)',  Icon: AlertTriangle },
}

/* ── One submission ──────────────────────────────────── */
function ReviewCard({ a }: { a: ReviewAssignment }) {
  const review = useReviewAssignment()
  const toast  = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [reason,    setReason]    = useState('')

  const { label, color, bg, Icon } = STATUS[a.status]
  const open = a.status === 'pending'

  const decide = async (decision: 'approved' | 'rejected') => {
    /* The API refuses a reasonless rejection with 400; catching it here just
       saves the round trip and keeps the cursor in the box. */
    if (decision === 'rejected' && !reason.trim()) {
      toast.error('Give a reason', 'The student needs to know what to change.')
      return
    }
    try {
      await review.mutateAsync({ id: a.id, decision, reason: decision === 'rejected' ? reason.trim() : undefined })
      toast.success(decision === 'approved' ? 'Approved' : 'Sent back to the student')
      setRejecting(false); setReason('')
    } catch (e: any) {
      const c = e?.response?.data?.error?.code
      if (c === 'ALREADY_REVIEWED') toast.error('Already reviewed', 'Someone else got here first — refresh.')
      else toast.error('Could not save', e?.response?.data?.error?.message ?? 'Please try again.')
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
      className="rounded-2xl bg-white p-4" style={{ border: '1px solid #E4E7ED' }}>

      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: bg }}>
          <Icon size={15} style={{ color }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: bg, color }}>{label}</span>
            {a.attempt > 1 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(99,102,241,0.10)', color: '#4F46E5' }}>
                <RotateCcw size={9} />Revision · attempt {a.attempt}
              </span>
            )}
          </div>
          <p className="truncate text-sm font-bold" style={{ color: '#0D0F1A' }}>{a.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: '#6B7280' }}>
            <span className="flex items-center gap-1"><User size={10} />{a.studentId?.name ?? 'Student'}</span>
            <span className="flex items-center gap-1"><Calendar size={10} />{a.liveClassId?.title ?? 'Class'}</span>
            {a.courseId?.title && <span className="flex items-center gap-1"><BookOpen size={10} />{a.courseId.title}</span>}
            {a.sectionId?.title && <span className="flex items-center gap-1"><Layers size={10} />{a.sectionId.title}</span>}
            <span>Sent {fmtDateTime(a.submittedAt)}</span>
          </div>
        </div>
      </div>

      {a.note && (
        <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: '#F4F5F8', color: '#4B5563' }}>{a.note}</p>
      )}

      {a.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.files.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-blue-50"
              style={{ background: '#F4F5F8', border: '1px solid #E4E7ED', color: '#374151' }}>
              {f.mimeType === 'application/pdf'
                ? <FileText size={11} style={{ color: '#DC2626' }} />
                : <ImageIcon size={11} style={{ color: '#0057b8' }} />}
              <span className="max-w-[180px] truncate">{f.name}</span>
              <span style={{ color: '#9CA3AF' }}>{fmtSize(f.sizeBytes)}</span>
            </a>
          ))}
        </div>
      )}

      {/* What was said last time, while judging a revision. */}
      {a.reviews.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: '#6B7280' }}>
            Earlier decisions ({a.reviews.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {a.reviews.map((r, i) => (
              <li key={i} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: '#F4F5F8', color: '#4B5563' }}>
                <span className="font-semibold">Attempt {r.attempt}: {r.status}</span>
                {r.reason && <> — {r.reason}</>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {open ? (
        <div className="mt-4">
          <AnimatePresence initial={false}>
            {rejecting && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000} autoFocus
                  placeholder="What should the student change? They receive this word for word."
                  className="mb-2 w-full resize-none rounded-xl px-3 py-2.5 text-xs outline-none"
                  style={{ border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.04)', color: '#0D0F1A' }} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void decide('approved')} disabled={review.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              style={{ background: '#059669' }}>
              <CheckCircle2 size={13} />Approve
            </button>

            {!rejecting ? (
              <button type="button" onClick={() => setRejecting(true)} disabled={review.isPending}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50"
                style={{ border: '1px solid rgba(239,68,68,0.30)', color: '#DC2626' }}>
                <XCircle size={13} />Send back
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void decide('rejected')} disabled={review.isPending}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: '#DC2626' }}>
                  <XCircle size={13} />Send back with this reason
                </button>
                <button type="button" onClick={() => { setRejecting(false); setReason('') }}
                  className="rounded-xl px-4 py-2 text-xs font-semibold"
                  style={{ border: '1px solid #E4E7ED', color: '#6B7280' }}>Cancel</button>
              </>
            )}
          </div>
        </div>
      ) : a.status === 'rejected' && a.lastReason ? (
        <div className="mt-3 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#DC2626' }}>
            Sent back — waiting on the student
          </p>
          <p className="text-xs" style={{ color: '#7F1D1D' }}>{a.lastReason}</p>
        </div>
      ) : (
        <p className="mt-3 text-[11px]" style={{ color: '#9CA3AF' }}>Reviewed {fmtDateTime(a.reviewedAt)}</p>
      )}
    </motion.div>
  )
}

/* ── Page ────────────────────────────────────────────── */
export default function AdminAssignmentsPage() {
  const [tab,    setTab]    = useState<'all' | ClassAssignmentStatus>('pending')
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, error } = useReviewQueue(tab)

  const list = useMemo(() => {
    const rows = data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.studentId?.name ?? '').toLowerCase().includes(q) ||
      (a.studentId?.email ?? '').toLowerCase().includes(q) ||
      (a.liveClassId?.title ?? '').toLowerCase().includes(q) ||
      (a.courseId?.title ?? '').toLowerCase().includes(q),
    )
  }, [data, search])

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: '#0D0F1A' }}>
          <ClipboardList size={20} style={{ color: '#0057b8' }} />Assignments
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: '#6B7280' }}>
          Work students sent after a live class. Approve it, or send it back with a reason.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([
          ['pending',  'Awaiting review'],
          ['rejected', 'Sent back'],
          ['approved', 'Approved'],
          ['all',      'All'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key as typeof tab)}
            className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors"
            style={tab === key
              ? { background: '#0057b8', color: '#fff' }
              : { background: '#fff', color: '#6B7280', border: '1px solid #E4E7ED' }}>
            {label}
          </button>
        ))}

        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9CA3AF' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student, class or title…"
            className="w-full rounded-xl py-2 pl-8 pr-3 text-xs outline-none"
            style={{ border: '1px solid #E4E7ED', background: '#fff', color: '#0D0F1A' }} />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl bg-white p-10 text-center text-sm" style={{ border: '1px solid #E4E7ED', color: '#6B7280' }}>
          Loading…
        </div>
      ) : isError ? (
        <div className="rounded-2xl p-6 text-center"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.20)' }}>
          <AlertTriangle size={20} style={{ color: '#DC2626' }} className="mx-auto mb-2" />
          <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>Could not load the queue</p>
          <p className="mt-1 text-xs" style={{ color: '#7F1D1D' }}>
            {(error as any)?.response?.data?.error?.message ?? 'Please try again.'}
          </p>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center" style={{ border: '1px solid #E4E7ED' }}>
          <ClipboardList size={22} style={{ color: '#9CA3AF' }} className="mx-auto mb-2" />
          <p className="text-sm font-semibold" style={{ color: '#0D0F1A' }}>
            {search ? 'Nothing matches that search' : tab === 'pending' ? 'Nothing waiting on you' : 'Nothing here'}
          </p>
          <p className="mt-1 text-xs" style={{ color: '#6B7280' }}>
            {search ? 'Try a different term.' : 'Submissions appear here as students send them.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {list.map(a => <ReviewCard key={a.id} a={a} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
