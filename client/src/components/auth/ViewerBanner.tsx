'use client'

import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'

export function ViewerBanner() {
  const { data: user } = useCurrentUser()

  if (!user || user.role !== 'viewer') return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3"
      style={{
        background: 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.18)',
      }}>
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'rgba(99,102,241,0.12)' }}>
        <Clock size={14} style={{ color: '#6366F1' }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Your account is pending approval
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          You can browse the platform, but course access and class bookings will be unlocked once an admin approves your account.
        </p>
      </div>
    </motion.div>
  )
}
