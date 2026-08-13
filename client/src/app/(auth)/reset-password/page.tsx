'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react'
import { resetPassword } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

const schema = z.object({
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Needs an uppercase letter')
    .regex(/[0-9]/, 'Needs a number'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, {
  message: "Passwords don't match",
  path: ['confirm'],
})
type Values = z.infer<typeof schema>

function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token  = params.get('token') ?? ''
  const [show, setShow]   = useState(false)
  const [done, setDone]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema) })

  if (!token) {
    return (
      <div className="rounded-2xl p-4 flex items-start gap-2 text-sm"
        style={{ background: '#FEE2E2', color: 'var(--color-danger)', border: '1px solid #FCA5A5' }}>
        <AlertCircle size={15} className="mt-0.5" />
        <div>
          <p className="font-semibold">Missing reset token</p>
          <p className="mt-1 text-xs">Open the link from your email. The token is part of the URL.</p>
        </div>
      </div>
    )
  }

  const onSubmit = async ({ password }: Values) => {
    setError(null)
    try {
      await resetPassword(token, password)
      setDone(true)
      setTimeout(() => router.replace('/login?reset=ok'), 1800)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'This reset link is invalid or has expired.')
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl p-4 flex items-start gap-2 text-sm"
        style={{ background: 'rgba(16,185,129,0.10)', color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.22)' }}>
        <CheckCircle2 size={16} className="mt-0.5" />
        <div>
          <p className="font-semibold">Password updated</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Redirecting you to sign in…</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          New password
        </label>
        <div className="relative">
          <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: errors.password ? '#EF4444' : 'var(--color-text-muted)' }} />
          <input {...register('password')} type={show ? 'text' : 'password'}
            placeholder="At least 8 characters, mixed case + number"
            autoComplete="new-password"
            className="w-full rounded-xl py-3 pl-10 pr-11 text-sm outline-none"
            style={{
              background: errors.password ? '#FEF2F2' : 'var(--color-bg-page)',
              border: `1.5px solid ${errors.password ? '#FCA5A5' : 'transparent'}`,
              color: 'var(--color-text-primary)',
            }} />
          <button type="button" onClick={() => setShow(v => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-text-muted)' }}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {errors.password && (
          <p className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
            <AlertCircle size={11} />{errors.password.message}
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Confirm password
        </label>
        <input {...register('confirm')} type={show ? 'text' : 'password'}
          placeholder="Re-enter the password"
          autoComplete="new-password"
          className="w-full rounded-xl py-3 pl-3.5 pr-4 text-sm outline-none"
          style={{
            background: errors.confirm ? '#FEF2F2' : 'var(--color-bg-page)',
            border: `1.5px solid ${errors.confirm ? '#FCA5A5' : 'transparent'}`,
            color: 'var(--color-text-primary)',
          }} />
        {errors.confirm && (
          <p className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
            <AlertCircle size={11} />{errors.confirm.message}
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
          style={{ background: '#FEE2E2', color: 'var(--color-danger)', border: '1px solid #FCA5A5' }}>
          <AlertCircle size={13} className="mt-0.5" />{error}
        </div>
      )}

      <motion.button type="submit" disabled={isSubmitting}
        whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all disabled:opacity-60"
        style={{ background: 'var(--color-primary)', boxShadow: '0 4px 18px rgba(0,87,184,0.30)' }}>
        {isSubmitting ? <><Spinner size={14} />Updating…</> : 'Set new password'}
      </motion.button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10" style={{ background: 'var(--color-bg-page)' }}>
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="w-full max-w-[420px] rounded-3xl bg-[var(--color-bg-surface)] p-8"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 24px 80px rgba(13,15,26,0.08)' }}>

        <Link href="/login" className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}>
          <ArrowLeft size={12} />Back to sign in
        </Link>

        <h1 className="text-[26px] font-bold leading-tight tracking-tight"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Reset your password
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Choose a strong new password. We&apos;ll sign you out of every device after the reset.
        </p>

        <div className="mt-6">
          <Suspense fallback={<div className="h-[260px]" />}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </motion.div>
    </div>
  )
}
