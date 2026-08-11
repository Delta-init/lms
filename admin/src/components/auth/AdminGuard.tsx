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

       Deliberately a BARE /login, with no session=expired marker.

       isError here means one /admin/auth/me call failed, which is not the
       same as "the session is gone" — a single blip, or one request caught
       in a refresh retry, is enough to trip it. The screen recording of the
       production fault shows exactly that: the admin was bounced off
       Learning Paths to the dashboard and stayed perfectly signed in
       afterwards, every other section working. Marking those redirects
       "expired" would strand a working session on the sign-in form, which
       is worse than the bounce it would be replacing.

       The genuinely-dead case does not need help from here. When a refresh
       is definitively rejected the API clears the cookies, so plain /login
       renders the form; and the axios interceptor, which is the only place
       that KNOWS the refresh was rejected, carries the marker itself. */
    if (isError || !user) {
      router.replace('/login')
      return
    }

    /* Logged in but not admin/instructor → end the session and bounce to
       login. No marker needed: logout() clears the cookies first, so the
       middleware sees no session and serves the form. */
    if (!isAllowed) {
      void logout().finally(() => {
        router.replace('/login?reason=not-admin')
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
