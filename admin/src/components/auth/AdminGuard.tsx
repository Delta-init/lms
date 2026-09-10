'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldOff, AlertCircle } from 'lucide-react'
import { useCurrentUser, logout } from '@/lib/api/user'
import Spinner from '@/components/ui/Spinner'

const ALLOWED_ROLES = ['super_admin', 'admin', 'sub_admin', 'support', 'instructor']

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data: user, isLoading, isError } = useCurrentUser()

  const isAllowed = ALLOWED_ROLES.includes(user?.role ?? '')

  /* ── Why this flag exists ──────────────────────────────────────────────
     Rendering on the server, `useCurrentUser` never runs, so `isLoading` is
     always true and the server emits the spinner below. On the client the
     query does run — and React 18 hydration is interruptible, so it can
     yield mid-hydration, let the /admin/auth/me response land, and resume
     with `isLoading` already false. React then finds the loaded tree where
     it expected a spinner and throws away the server HTML for this whole
     subtree:

       Hydration failed because the server rendered HTML didn't match the
       client.

     It is a RACE, so it reproduces perhaps one load in three rather than
     every time, which is what made it look page-specific rather than
     structural. Every page under (dashboard) sits inside this guard, so
     every one of them can hit it.

     `mounted` is false during SSR and false on the FIRST client render, so
     those two agree by construction — whatever the query has done by then.
     The effect flips it after hydration is safely finished, and the real
     branch is chosen in a normal re-render where a mismatch is impossible.
     No extra flash: the spinner is already what the server was sending. */
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

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

  if (!mounted || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3" style={{ background: '#080A12' }}>
        <Spinner size={20} />
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>Verifying access…</p>
      </div>
    )
  }

  /* A failed /admin/auth/me is NOT a role rejection, and this used to report
     it as one.

     `user` is undefined in two unrelated situations: the account really is
     not allowed here, and the call simply did not answer — a blip, an access
     token that expired while a refresh was still in flight, a backend mid
     restart. Both landed in the branch below, so an admin who had been signed
     in all day was told "This portal is for admins and instructors only" —
     a sentence that reads as their access having been revoked. It had not
     been: the next attempt signs in normally, which is exactly the tell that
     nothing about their ROLE had changed.

     A role verdict is only honest once a role has actually been read. */
  if (isError || !user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4" style={{ background: '#080A12' }}>
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
          style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.22)' }}>
          <AlertCircle size={22} style={{ color: '#F59E0B' }} />
        </div>
        <p className="text-base font-bold" style={{ color: 'white' }}>Could not verify your session</p>
        <p className="text-sm max-w-sm text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>
          The server did not answer. Taking you to sign in — your account is fine.
        </p>
      </div>
    )
  }

  if (!isAllowed) {
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
