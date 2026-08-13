'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react'
import { forgotPassword } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
})
type Values = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema) })

  const onSubmit = async ({ email }: Values) => {
    setError(null)
    try {
      await forgotPassword(email)
      setDone(true)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Something went wrong. Try again.')
    }
  }

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
          Forgot your password?
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Enter your email and we&apos;ll send you a link to reset it. The link expires in 60 minutes.
        </p>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="mt-6 rounded-2xl p-4 flex items-start gap-3"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.22)' }}>
              <CheckCircle2 size={18} style={{ color: 'var(--color-success)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>Check your email</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  If an account exists with that email, we&apos;ve sent a reset link.
                  It may take a minute to arrive. Don&apos;t forget to check your spam folder.
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  Email address
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2"
                    style={{ color: errors.email ? '#EF4444' : 'var(--color-text-muted)' }} />
                  <input
                    {...register('email')}
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full rounded-xl py-3 pl-10 pr-4 text-sm outline-none transition-all"
                    style={{
                      background: errors.email ? '#FEF2F2' : 'var(--color-bg-page)',
                      border: `1.5px solid ${errors.email ? '#FCA5A5' : 'transparent'}`,
                      color: 'var(--color-text-primary)',
                    }}
                    onFocus={e => { e.currentTarget.style.border = `1.5px solid ${errors.email ? '#EF4444' : '#2F6BFF'}`; e.currentTarget.style.background = '#FFFFFF' }}
                    onBlur={e => { e.currentTarget.style.border = `1.5px solid ${errors.email ? '#FCA5A5' : 'transparent'}`; e.currentTarget.style.background = errors.email ? '#FEF2F2' : 'var(--color-bg-page)' }} />
                </div>
                <AnimatePresence>
                  {errors.email && (
                    <motion.p initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                      <AlertCircle size={11} />{errors.email.message}
                    </motion.p>
                  )}
                </AnimatePresence>
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
                {isSubmitting
                  ? <><Spinner size={14} />Sending…</>
                  : 'Send reset link'}
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
