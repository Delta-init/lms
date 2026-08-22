'use client'

import { useEffect } from 'react'
import { installContextMenuGuard } from '@/lib/contextMenuGuard'

/* Mounted once from the root providers; renders nothing. See
   lib/contextMenuGuard.ts for exactly what is and is not suppressed. */
export function ContextMenuGuard() {
  useEffect(() => installContextMenuGuard(), [])
  return null
}
