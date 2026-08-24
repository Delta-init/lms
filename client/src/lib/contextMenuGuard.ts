'use client'

/* ─────────────────────────────────────────────────────
   contextMenuGuard — suppress the browser context menu across the app.

   Site-wide by request: every page of both portals. The menu is blocked over
   text, images, links, video and empty space alike, which is what removes
   "Save image as…", "Save video as…", "View page source" and "Inspect" from
   the right-click path.

   ONE exemption, deliberate:
     • ALWAYS allow inside editable fields — input, textarea, select and
       contenteditable. Blocking there removes right-click → Paste and
       spell-check, and this app's longest forms are the KYC registration
       flow, support tickets and assignment notes. Users paste into those
       constantly; taking that away costs real people something every day and
       protects nothing, because a form field holds the user's own input.

   Everything else is blocked, including links — so "open in new tab" is gone
   app-wide. That is a real navigation cost and it is the accepted trade.

   Worth being clear about what this is: a speed bump for casual saving, not a
   control. Ctrl+S, Ctrl+U, F12, the direct CDN URL, screen recording and
   simply reading the API with curl are all untouched — none of them go
   through this menu. The forensic watermark remains the thing that actually
   survives a determined copier.
───────────────────────────────────────────────────── */

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

let installed = false

function onContextMenu(e: MouseEvent): void {
  const target = e.target as Element | null

  /* No usable target (or a non-Element, e.g. the bare document) — there is
     nothing to exempt, so block. */
  if (!target || typeof target.closest !== 'function') { e.preventDefault(); return }

  /* Never interfere with typing, pasting or spell-check. */
  if (target.closest(EDITABLE)) return

  e.preventDefault()
}

export function installContextMenuGuard(): () => void {
  if (installed || typeof document === 'undefined') return () => {}
  installed = true
  /* Capture phase so a component's own handler cannot swallow it first. */
  document.addEventListener('contextmenu', onContextMenu, { capture: true })
  return () => {
    document.removeEventListener('contextmenu', onContextMenu, { capture: true })
    installed = false
  }
}
