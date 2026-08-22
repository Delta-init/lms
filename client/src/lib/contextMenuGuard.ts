'use client'

/* ─────────────────────────────────────────────────────
   contextMenuGuard — suppress the browser menu over protected media only.

   Scoped deliberately. A blanket `contextmenu` block is one line, but it also
   removes paste and spell-check from every form field — which on this app
   means the KYC registration form, support tickets and assignment notes — and
   removes "open in new tab" from every course link. Those cost real users
   something and protect nothing.

   So the rule is narrow:
     • BLOCK  over a media element or anything inside [data-protected-content]
       — this is what removes the player's "Save video as…" entry
     • ALLOW  everywhere else, and ALWAYS inside editable fields, even if one
       is nested inside a protected region

   Worth being clear about what this is: a speed bump for casual saving, not a
   control. Ctrl+S, view-source, DevTools, the direct CDN URL and screen
   recording are all untouched. The forensic watermark remains the thing that
   actually survives a determined copier.
───────────────────────────────────────────────────── */

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
const PROTECTED = '[data-protected-content], video, media-player, mux-player'

let installed = false

function onContextMenu(e: MouseEvent): void {
  const target = e.target as Element | null
  if (!target || typeof target.closest !== 'function') return

  /* Never interfere with typing, pasting or spell-check. */
  if (target.closest(EDITABLE)) return

  if (target.closest(PROTECTED)) e.preventDefault()
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
