'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LifeBuoy, Send, CheckCircle2, Clock,
  XCircle, Plus, ChevronLeft, Circle, AlertCircle,
} from 'lucide-react'
import {
  useMyTickets, useTicket, useReplyTicket, useCreateTicket,
  type SupportTicket, type SupportStatus, type SupportCategory,
} from '@/lib/api/support'
import Spinner from '@/components/ui/Spinner'

/* ─── helpers ──────────────────────────────────────── */
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const STATUS_META: Record<SupportStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  open:     { label: 'Open',      color: '#2563EB', bg: 'var(--color-primary-light)', icon: Circle },
  pending:  { label: 'In review', color: '#D97706', bg: '#FEF3C7', icon: Clock },
  resolved: { label: 'Resolved',  color: 'var(--color-success)', bg: '#DCFCE7', icon: CheckCircle2 },
  closed:   { label: 'Closed',    color: 'var(--color-text-muted)', bg: 'var(--color-bg-subtle)', icon: XCircle },
}

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'technical', label: 'Technical Issue' },
  { value: 'billing',   label: 'Billing / Payment' },
  { value: 'course',    label: 'Course Content' },
  { value: 'account',   label: 'Account & Profile' },
  { value: 'other',     label: 'Other' },
]

function StatusBadge({ status }: { status: SupportStatus }) {
  const m = STATUS_META[status]
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold"
      style={{ background: m.bg, color: m.color }}>
      <Icon size={10} />
      {m.label}
    </span>
  )
}

/* ─── New Ticket Form ─────────────────────────────── */
function NewTicketForm({ onDone }: { onDone: () => void }) {
  const createMut = useCreateTicket()
  const [subject,  setSubject]  = useState('')
  const [category, setCategory] = useState<SupportCategory>('technical')
  const [message,  setMessage]  = useState('')
  const [error,    setError]    = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!subject.trim() || !message.trim()) { setError('Subject and message are required.'); return }
    try {
      await createMut.mutateAsync({ subject: subject.trim(), category, message: message.trim() })
      onDone()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Something went wrong.')
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={onDone} className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-bg-muted)]">
          <ChevronLeft size={16} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>New support request</h2>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Subject</label>
          <input
            value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Briefly describe your issue"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }} />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Category</label>
          <select value={category} onChange={e => setCategory(e.target.value as SupportCategory)}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Message</label>
          <textarea
            value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Describe your issue in detail…"
            rows={5}
            className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }} />
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-danger)' }}>
            <AlertCircle size={13} /> {error}
          </p>
        )}

        <button type="submit" disabled={createMut.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-all disabled:opacity-60"
          style={{ background: 'var(--color-primary)' }}>
          {createMut.isPending ? <><Spinner size={14} />Submitting…</> : 'Submit Request'}
        </button>
      </form>
    </motion.div>
  )
}

/* ─── Thread view ─────────────────────────────────── */
function ThreadView({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { data: ticket, isLoading } = useTicket(ticketId)
  const replyMut = useReplyTicket(ticketId)
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [ticket?.messages.length])

  const send = async () => {
    if (!draft.trim() || replyMut.isPending) return
    await replyMut.mutateAsync(draft.trim())
    setDraft('')
  }

  if (isLoading) return (
    <div className="flex h-48 items-center justify-center gap-2">
      <Spinner size={16} />
    </div>
  )
  if (!ticket) return null

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <button onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--color-text-muted)' }}>
          <ChevronLeft size={14} /> Back to tickets
        </button>
        <div className="rounded-2xl p-4" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>{ticket.subject}</h3>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={ticket.status} />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {CATEGORIES.find(c => c.value === ticket.category)?.label}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>·</span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Opened {fmtDate(ticket.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto pb-4" style={{ minHeight: 0 }}>
        {ticket.messages.map((m, i) => {
          const fromAdmin = m.senderRole === 'admin'
          const sender    = typeof m.senderId === 'object' ? m.senderId : null
          return (
            <div key={m._id ?? i} className={`flex ${fromAdmin ? 'justify-start' : 'justify-end'}`}>
              <div className="max-w-[85%]">
                <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
                  style={fromAdmin
                    ? { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', borderBottomLeftRadius: 6 }
                    : { background: 'var(--color-primary)', color: 'white', borderBottomRightRadius: 6 }}>
                  {fromAdmin && (
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-primary)' }}>
                      Support Team
                    </p>
                  )}
                  {m.body}
                </div>
                <p className={`mt-1 text-[10px] ${fromAdmin ? '' : 'text-right'}`} style={{ color: 'var(--color-text-muted)' }}>
                  {fmtDate(m.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply */}
      {ticket.status !== 'closed' ? (
        <div className="flex-shrink-0 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex gap-2">
            <textarea
              value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Add a reply…"
              rows={3}
              className="flex-1 resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
            <button onClick={send} disabled={!draft.trim() || replyMut.isPending}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center self-end rounded-xl transition-all disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}>
              {replyMut.isPending
                ? <Spinner size={14} variant="white" />
                : <Send size={14} color="white" />}
            </button>
          </div>
          {ticket.status === 'resolved' && (
            <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              This ticket is resolved. Replying will reopen it.
            </p>
          )}
        </div>
      ) : (
        <div className="flex-shrink-0 pt-3 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
          This ticket is closed. Open a new request if you need further help.
        </div>
      )}
    </motion.div>
  )
}

/* ─── Ticket list ─────────────────────────────────── */
function TicketList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data: tickets = [], isLoading } = useMyTickets()

  if (isLoading) return (
    <div className="flex h-32 items-center justify-center gap-2">
      <Spinner size={16} />
    </div>
  )

  if (tickets.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ background: 'var(--color-bg-subtle)' }}>
        <LifeBuoy size={22} style={{ color: 'var(--color-text-muted)' }} />
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>No requests yet</p>
      <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
        Submit a request above and our team will respond shortly.
      </p>
    </div>
  )

  return (
    <div className="space-y-2">
      {tickets.map(ticket => (
        <motion.button
          key={ticket.id}
          onClick={() => onSelect(ticket.id)}
          whileHover={{ y: -1 }}
          className="w-full text-left rounded-2xl p-4 transition-all"
          style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{ticket.subject}</p>
                {ticket.userUnread && (
                  <span className="flex h-2 w-2 flex-shrink-0 rounded-full" style={{ background: 'var(--color-primary)' }} />
                )}
              </div>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {ticket.messages.length} {ticket.messages.length === 1 ? 'message' : 'messages'} · Last reply {fmtDate(ticket.lastMessageAt)}
              </p>
            </div>
            <StatusBadge status={ticket.status} />
          </div>
          {ticket.lastSenderRole === 'admin' && ticket.status !== 'resolved' && ticket.status !== 'closed' && (
            <p className="mt-2 text-xs rounded-lg px-2 py-1 inline-block" style={{ background: 'var(--color-primary-light)', color: '#2563EB' }}>
              Support team replied, tap to view
            </p>
          )}
        </motion.button>
      ))}
    </div>
  )
}

/* ─── Main ────────────────────────────────────────── */
export default function SupportPage() {
  const [view,       setView]       = useState<'list' | 'new' | 'thread'>('list')
  const [activeId,   setActiveId]   = useState<string | null>(null)

  const openTicket = (id: string) => { setActiveId(id); setView('thread') }

  return (
    <div className="mx-auto max-w-2xl space-y-0">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(0,87,184,0.08)' }}>
            <LifeBuoy size={17} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Help & Support
            </h1>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Get help from our support team
            </p>
          </div>
        </div>

        {view === 'list' && (
          <motion.button
            onClick={() => setView('new')}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white"
            style={{ background: 'var(--color-primary)' }}>
            <Plus size={14} /> New Request
          </motion.button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {view === 'new' && (
          <motion.div key="new" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="rounded-2xl bg-[var(--color-bg-surface)] p-6"
            style={{ border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <NewTicketForm onDone={() => setView('list')} />
          </motion.div>
        )}

        {view === 'thread' && activeId && (
          <motion.div key="thread" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col" style={{ height: 'calc(100vh - 220px)' }}>
            <ThreadView ticketId={activeId} onBack={() => { setActiveId(null); setView('list') }} />
          </motion.div>
        )}

        {view === 'list' && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Info banner */}
            <div className="mb-4 flex items-start gap-3 rounded-2xl p-4"
              style={{ background: 'rgba(0,87,184,0.04)', border: '1px solid rgba(0,87,184,0.12)' }}>
              <LifeBuoy size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: '#1e3a5f' }}>
                  How can we help?
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#4B6A8B' }}>
                  Submit a request and our team will respond within 24 hours. You&apos;ll receive a notification when we reply.
                </p>
              </div>
            </div>

            <TicketList onSelect={openTicket} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
