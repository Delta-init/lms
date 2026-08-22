'use client'

/* ─────────────────────────────────────────────────────
   WatermarkOverlay — anti-piracy forensic watermark.

   Two layers over every video surface:
     1. a fixed, faint company mark (top-right), and
     2. the signed-in student's email · phone in a small
        ~35%-opacity tag that drifts to a different edge
        zone every few seconds.

   The drift is the point: a static mark can be cropped or
   masked out of a re-encoded copy — a moving one cannot,
   so any screen-recorded leak carries the identity of the
   account that leaked it.

   Deliberately NON-obstructive: pointer-events pass through
   to the player controls, the text is small and translucent,
   and the zones hug the edges — never the centre of the
   frame, never the control bar.

   Mount it INSIDE the element that enters fullscreen
   (Vidstack: as a <MediaPlayer> child; Mux: in the wrapper
   that our custom fullscreen button targets), otherwise the
   browser will composite fullscreen video above it.
───────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCurrentUser } from '@/lib/api/user'

/* [top%, left%, anchorRight] — edge zones only. The bottom rows stop at 68%
   so the tag never sits on a control bar; nothing is ever centre-frame. */
const ZONES: Array<[number, number, boolean]> = [
  [7, 4, false], [7, 55, false],
  [26, 96, true], [34, 4, false],
  [50, 96, true], [52, 4, false],
  [66, 30, false], [68, 96, true],
]
const MOVE_EVERY_MS = 7000

export function WatermarkOverlay({ brand = 'DELTA INSTITUTIONS' }: { brand?: string }) {
  const { data: user } = useCurrentUser()
  const [zone, setZone] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setZone(z => {
        let next = Math.floor(Math.random() * ZONES.length)
        if (next === z) next = (next + 1) % ZONES.length
        return next
      })
    }, MOVE_EVERY_MS)
    return () => clearInterval(id)
  }, [])

  const tag = useMemo(() => {
    const phone = user?.enrollmentApplication?.phone
    return [user?.email, phone].filter(Boolean).join(' · ')
  }, [user])

  const [top, left, anchorRight] = ZONES[zone]!
  const containerRef = useRef<HTMLDivElement>(null)

  /* ── Tamper guard ─────────────────────────────────────
     "Inspect → delete the node" (or display:none / wiping the text) must not
     yield an unwatermarked video. Two channels run the same integrity check —
     a 1.5s interval, plus the video's own `timeupdate` events so enforcement
     is hottest exactly while footage is rolling (timeupdate also dodges timer
     throttling in background tabs, since playing media keeps firing it).

     On violation: PAUSE the media in this player, then self-heal — re-attach
     the detached container, strip injected hiding styles, restore the
     identity text. Net effect for the DevTools user: the tag reappears and
     the video stops until the watermark is intact again. Only patching the
     app's own JavaScript defeats this, which is a far higher bar than the
     Elements panel — and the honest-viewer recordings this feature exists
     for always carry the mark. */
  useEffect(() => {
    const container = containerRef.current
    const host = container?.parentElement
    if (!container || !host) return

    const media = () =>
      (host.querySelector('video') as HTMLVideoElement | null)
      ?? (host.querySelector('mux-player') as unknown as { pause?: () => void } | null)

    const strip = (el: HTMLElement | null) => {
      if (!el) return
      for (const p of ['display', 'visibility', 'opacity']) el.style.removeProperty(p)
    }

    const intact = (): boolean => {
      if (!container.isConnected) return false
      const cs = getComputedStyle(container)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
      const idEl = container.querySelector('[data-wm-id]') as HTMLElement | null
      if (tag) {
        if (!idEl || !idEl.isConnected || idEl.textContent !== tag) return false
        const ics = getComputedStyle(idEl)
        if (ics.display === 'none' || ics.visibility === 'hidden' || Number(ics.opacity) < 0.05) return false
      }
      return true
    }

    const enforce = () => {
      if (intact()) return
      media()?.pause?.()
      /* self-heal the realistic Elements-panel attacks */
      if (!container.isConnected && host.isConnected) host.appendChild(container)
      strip(container)
      const idEl = container.querySelector('[data-wm-id]') as HTMLElement | null
      strip(idEl)
      if (tag && idEl && idEl.textContent !== tag) idEl.textContent = tag
    }

    const iv = setInterval(enforce, 1500)
    const vid = host.querySelector('video')
    vid?.addEventListener('timeupdate', enforce)
    return () => { clearInterval(iv); vid?.removeEventListener('timeupdate', enforce) }
  }, [tag])

  return (
    <div ref={containerRef} aria-hidden data-wm className="pointer-events-none absolute inset-0 z-40 select-none overflow-hidden">
      {/* Fixed company mark */}
      <span
        style={{
          position: 'absolute', top: '3.5%', right: '3%',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
          color: 'rgba(255,255,255,0.40)', textShadow: '0 1px 2px rgba(0,0,0,0.55)',
          fontFamily: 'inherit',
        }}>
        {brand}
      </span>

      {/* Roaming viewer identity */}
      {tag && (
        <span
          data-wm-id
          style={{
            position: 'absolute',
            top: `${top}%`, left: `${left}%`,
            transform: anchorRight ? 'translateX(-100%)' : 'none',
            transition: 'top 1.8s ease, left 1.8s ease, transform 1.8s ease',
            fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
            color: 'rgba(255,255,255,0.34)', textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            fontFamily: 'inherit',
          }}>
          {tag}
        </span>
      )}
    </div>
  )
}
