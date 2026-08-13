'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, X, CheckCircle2 } from 'lucide-react'
import { useCurrentUser, resendVerification } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

const STORAGE_KEY = 'lms-verify-banner-dismissed-at'

function isRecentlyDismissed(): boolean {
  if (typeof window === 'undefined') return false
  const at = window.localStorage.getItem(STORAGE_KEY)
  if (!at) return false
  return Date.now() - Number(at) < 24 * 60 * 60 * 1000
}

export function VerifyEmailBanner() {
  const { data: user } = useCurrentUser()
  const [dismissed, setDismissed] = useState(() => isRecentlyDismissed())
  const [sending,   setSending]   = useState(false)
  const [sent,      setSent]      = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  if (!user || user.isVerified || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()))
    }
  }

  const resend = async () => {
    setSending(true); setError(null)
    try {
      await resendVerification()
      setSent(true)
      setTimeout(() => setSent(false), 4000)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Could not send.')
    } finally {
      setSending(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
        className="mb-4 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5"
        style={{
          background: 'rgba(0,87,184,0.06)',
          border: '1px solid rgba(0,87,184,0.16)',
        }}>

        <Mail size={13} className="flex-shrink-0" style={{ color: 'var(--color-primary)' }} />

        <p className="min-w-0 flex-1 text-xs font-medium truncate" style={{ color: '#1e3a5f' }}>
          <span className="hidden sm:inline">Verify your email to unlock full access. </span>
          <span className="sm:hidden">Verify </span>
          <span className="font-semibold truncate">{user.email}</span>
        </p>

        {error && (
          <span className="hidden sm:inline text-xs" style={{ color: 'var(--color-danger)' }}>{error}</span>
        )}

        <button
          onClick={resend}
          disabled={sending || sent}
          className="flex-shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold text-white transition-all disabled:opacity-60"
          style={{ background: 'var(--color-primary)' }}>
          {sending
            ? <><Spinner size={11} /><span className="hidden sm:inline">Sending…</span></>
            : sent
              ? <><CheckCircle2 size={11} /><span className="hidden sm:inline">Sent</span></>
              : <><Mail size={11} /><span className="hidden sm:inline">Resend</span><span className="sm:hidden">Resend</span></>}
        </button>

        <button onClick={dismiss} aria-label="Dismiss"
          className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)]"
          style={{ color: 'var(--color-text-muted)' }}>
          <X size={12} />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
