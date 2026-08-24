'use client'

import { useEffect } from 'react'
import { installContextMenuGuard } from '@/lib/contextMenuGuard'

/* Mounted once from the root providers; renders nothing. Blocks the context
   menu app-wide except inside editable fields. See lib/contextMenuGuard.ts
   for exactly what is and is not suppressed. */
export function ContextMenuGuard() {
  useEffect(() => installContextMenuGuard(), [])
  return null
}
