'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { orgTimeZone, setActiveTimeZone } from '@/lib/timezone'   // side effect: installs the academy-zone formatters
import { useCurrentUser } from '@/lib/api/user'
import { useMyOrganization } from '@/lib/currency'
import { useOrgStore } from '@/store/org.store'
import { DevtoolsGuard } from '@/components/security/DevtoolsGuard'

/* Resolves which academy's clock this session runs on and applies it:
   super admin → the org switcher ("All Orgs" → Dubai); everyone else → their
   own academy. The resolved zone is set synchronously during render (so this
   pass already formats correctly), and keying the subtree on it remounts the
   page when the zone changes — every rendered date re-formats immediately on
   an org switch instead of waiting for the next poll. */
function TimezoneScope({ children }: { children: React.ReactNode }) {
  const { data: user }  = useCurrentUser()
  const activeOrgSlug   = useOrgStore(s => s.activeOrgSlug)
  const { data: myOrg } = useMyOrganization()

  const tz = user?.role === 'super_admin'
    ? orgTimeZone(activeOrgSlug)
    : orgTimeZone(myOrg?.slug)
  setActiveTimeZone(tz)

  return <div key={tz} style={{ display: 'contents' }}>{children}</div>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return (
    <QueryClientProvider client={queryClient}>
      <DevtoolsGuard />
      <TimezoneScope>{children}</TimezoneScope>
    </QueryClientProvider>
  )
}
