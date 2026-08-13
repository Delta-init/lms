'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Mail } from 'lucide-react'
import { verifyEmail } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

function VerifyEmailInner() {
  const params = useSearchParams()
  const token  = params.get('token') ?? ''
  const [state, setState] = useState<'verifying' | 'ok' | 'error'>('verifying')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!token) {
        setState('error')
        setErrorMsg('No token in the URL. Open the link from your verification email.')
        return
      }
      try {
        await verifyEmail(token)
        if (!cancelled) setState('ok')
      } catch (err: any) {
        if (cancelled) return
        setState('error')
        setErrorMsg(err?.response?.data?.error?.message ?? 'This verification link is invalid or has expired.')
      }
    }
    void run()
    return () => { cancelled = true }
  }, [token])

  if (state === 'verifying') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Spinner size={26} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Verifying your email…</p>
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
        <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Email verified</p>
        <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
          Thanks for confirming. You now have full access to notifications, certificates, and account recovery.
        </p>
        <Link href="/my-learning" className="mt-3 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>
          Go to My Learning
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
      <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Couldn&apos;t verify</p>
      <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-muted)' }}>{errorMsg}</p>
      <Link href="/login" className="mt-3 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
        Back to sign in
      </Link>
    </div>
  )
}

export default function VerifyEmailPage() {
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
            Email verification
          </span>
        </div>
        <Suspense fallback={<div className="h-[160px]" />}>
          <VerifyEmailInner />
        </Suspense>
      </motion.div>
    </div>
  )
}
