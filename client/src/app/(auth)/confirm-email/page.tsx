'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Mail } from 'lucide-react'
import { confirmEmailChange } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

/* Where the link in the new mailbox lands.

   Deliberately in the (auth) group and NOT behind a session: the link is
   opened from an inbox, which is routinely a different browser or device from
   the one holding the signed-in session. The single-use token is the whole
   credential — requiring a cookie here would strand anybody who reads mail on
   their phone. */
function ConfirmEmailInner() {
  const params = useSearchParams()
  const token  = params.get('token') ?? ''
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working')
  const [email, setEmail] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  /* The token is single-use, so it may be spent EXACTLY once. React 18 runs
     effects twice in development, and without this guard the second run spends
     an already-claimed token and paints "invalid or expired" over a change
     that had in fact just succeeded. */
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    let cancelled = false
    async function run() {
      if (!token) {
        setState('error')
        setErrorMsg('No token in the URL. Open the link from the confirmation email.')
        return
      }
      try {
        const out = await confirmEmailChange(token)
        if (cancelled) return
        setEmail(out.email)
        setState('ok')
      } catch (err: any) {
        if (cancelled) return
        setState('error')
        setErrorMsg(err?.response?.data?.error?.message ?? 'This link is invalid or has expired.')
      }
    }
    void run()
    return () => { cancelled = true }
  }, [token])

  if (state === 'working') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Spinner size={26} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Confirming your new address…</p>
      </div>
    )
  }

  if (state === 'ok') {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.22)' }}>
          <CheckCircle2 size={24} style={{ color: 'var(--color-success)' }} />
        </div>
        <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Email address changed</p>
        <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
          Your account now uses <strong>{email}</strong>. Sign in with it from now on —
          your old address no longer works.
        </p>
        <Link href="/login" className="mt-3 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
        style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)' }}>
        <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
      </div>
      <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Couldn&apos;t change it</p>
      <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>{errorMsg}</p>
      {/* Nothing was lost: the account still uses the address it had, so the
          honest next step is to sign in with that one and ask again. */}
      <p className="text-xs max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
        Your account still uses your existing address. Sign in with it and start the change again.
      </p>
      <Link href="/login" className="mt-3 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
        Back to sign in
      </Link>
    </div>
  )
}

export default function ConfirmEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10" style={{ background: 'var(--color-bg-page)' }}>
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="w-full max-w-[460px] rounded-3xl bg-[var(--color-bg-surface)] p-8"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 24px 80px rgba(13,15,26,0.08)' }}>
        <div className="mb-2 flex items-center gap-2">
          <Mail size={16} style={{ color: 'var(--color-primary)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
            Email change
          </span>
        </div>
        <Suspense fallback={<div className="h-[160px]" />}>
          <ConfirmEmailInner />
        </Suspense>
      </motion.div>
    </div>
  )
}
