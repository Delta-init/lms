'use client'

import { useLayoutEffect, useState } from 'react'

/* ─────────────────────────────────────────────────────
   Keep a fixed-position dropdown stuck to the button that opened it, and out
   from under the fixed header.

   The class-schedule filter dropdowns are `position: fixed` on purpose: their
   row sits inside a height-animating wrapper carrying `overflow-hidden`,
   which would clip an absolutely-positioned panel. Two things follow from
   that choice, and both were missing:

     · fixed coordinates are relative to the VIEWPORT, and these were measured
       exactly once, in the click handler. Scroll afterwards and the button
       moves while the panel stays where it was, floating over unrelated
       content with no visible connection to its trigger. Re-measuring on
       scroll and resize is what makes `fixed` behave as though attached.

     · a fixed panel also ignores the fixed header. Once the trigger scrolls up
       behind the header, the panel — still faithfully anchored to it — is
       drawn ON TOP of the header. Anchoring alone made that more visible, not
       less, because the panel now follows the button all the way up.

   So the panel is hidden while its trigger is not itself visible: behind the
   header, or scrolled off the bottom. It reappears on the way back rather than
   closing, so scrolling past a filter does not throw away the menu you opened.

   The scroll listener uses the CAPTURE phase because scroll events do not
   bubble: without it, a scroll inside any ancestor container is never heard,
   and only a window-level scroll would correct the position.

   Lives here rather than beside one dropdown because three of them share it,
   and because a hook in a page module cannot be exercised on its own.
───────────────────────────────────────────────────── */

/** Height of the fixed app header, from the token both it and the layout read. */
function headerHeight(): number {
  if (typeof window === 'undefined') return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-h')
  return parseFloat(raw) || 0
}

export interface AnchoredPosition {
  top: number
  left: number
  /** False while the trigger is behind the header or scrolled off-screen. */
  visible: boolean
}

export function useAnchoredPosition(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  /** Gap between the bottom of the trigger and the top of the panel. */
  offset = 6,
): AnchoredPosition {
  const [pos, setPos] = useState<AnchoredPosition>({ top: 0, left: 0, visible: false })

  useLayoutEffect(() => {
    if (!open) return

    const measure = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      setPos({
        top:  r.bottom + offset,
        left: r.left,
        /* The panel starts just below the trigger, so the trigger's own bottom
           edge clearing the header is exactly the condition for the panel to
           clear it too.

           Only the header is checked. A trigger scrolled off the BOTTOM puts
           its panel below the viewport, where it is already invisible and
           harmless — and testing for that would mean reading a viewport
           height, which is not always available (a backgrounded tab reports
           0 for innerHeight, clientHeight and visualViewport alike, which
           would hide every panel for no reason). */
        visible: r.bottom > headerHeight(),
      })
    }

    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, ref, offset])

  return pos
}
