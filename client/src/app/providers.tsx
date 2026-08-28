'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { DevtoolsGuard } from '@/components/security/DevtoolsGuard'
import { ContextMenuGuard } from '@/components/security/ContextMenuGuard'
import { ImpersonationBanner } from '@/components/security/ImpersonationBanner'
// Dates render in the student's device timezone — the old app-wide Asia/Dubai
// pin was removed deliberately (see src/lib/timezone.ts).

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return (
    <QueryClientProvider client={qc}>
      <DevtoolsGuard />
      <ContextMenuGuard />
      <ImpersonationBanner />
      {children}
    </QueryClientProvider>
  )
}
