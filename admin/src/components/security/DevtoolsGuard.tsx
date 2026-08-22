'use client'

import { useEffect } from 'react'
import { installDevtoolsGuard } from '@/lib/devtoolsGuard'

/* Mounted once from the root providers. Renders nothing; the guard itself is
   a timer that navigates to /blocked when DevTools is detected. See
   lib/devtoolsGuard.ts for what it can and cannot actually enforce. */
export function DevtoolsGuard() {
  useEffect(() => installDevtoolsGuard(), [])
  return null
}
