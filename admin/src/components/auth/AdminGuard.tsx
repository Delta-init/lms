'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldOff } from 'lucide-react'
import { useCurrentUser, logout } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

const ALLOWED_ROLES = ['super_admin', 'admin', 'sub_admin', 'support', '4x_admin', 'digital_marketing_admin', 'ai_admin', 'instructor']

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data: user, isLoading, isError } = useCurrentUser()

  const isAllowed = ALLOWED_ROLES.includes(user?.role ?? '')

  useEffect(() => {
    if (isLoading) return

    /* No session at all → middleware should have handled it, but fail safe.

       Carries session=expired for the same reason the axios interceptor
       does: the cookie is still in the jar (that is why middleware let us
       render at all), so a bare /login would be bounced straight back here
       and this guard would fire again — a reload loop. The marker tells the
       middleware the cookie is known-dead and the form should be shown. */
    if (isError || !user) {
      router.replace('/login?session=expired')
      return
    }

    /* Logged in but not admin/instructor → end the session and bounce to login. */
    if (!isAllowed) {
      void logout().finally(() => {
        router.replace('/login?reason=not-admin&session=expired')
      })
    }
  }, [isLoading, isError, user, isAllowed, router])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3" style={{ background: '#080A12' }}>
        <Spinner size={20} />
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>Verifying access…</p>
      </div>
    )
  }

  if (!user || !isAllowed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4" style={{ background: '#080A12' }}>
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)' }}>
          <ShieldOff size={22} style={{ color: '#EF4444' }} />
        </div>
        <p className="text-base font-bold" style={{ color: 'white' }}>Access denied</p>
        <p className="text-sm max-w-sm text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>
          This portal is for admins and instructors only. Redirecting to login…
        </p>
      </div>
    )
  }

  return <>{children}</>
}
