'use client'

/* ─────────────────────────────────────────────────────
   devtoolsGuard — navigate away when DevTools appears to be open.

   TWO HEURISTICS, both requested:

   A. debugger timing — a `debugger` statement is a no-op when nothing is
      attached, but pauses execution when DevTools is open with breakpoints
      active. Timing the statement therefore times the pause.

   B. console getter — logging an object whose property has a getter: the
      getter only runs if something actually *renders* that object, which in
      practice means the Console panel is painting it.

   HONEST LIMITS — this deters, it does not protect:
     • `window.close()` is ignored for a tab the user opened themselves, so
       the action is a redirect, not a close.
     • Both heuristics are defeated by trivial means (disable breakpoints,
       "Never pause here", or just reading the API with curl/a proxy, which
       never opens DevTools at all).
     • They can false-positive on slow devices, so this waits for
       STRIKES_TO_TRIP consecutive detections and skips hidden tabs, where
       background throttling makes any timing meaningless.

   SAFETY VALVES — deliberately kept, so this cannot brick the app:
     • never runs outside production
     • NEXT_PUBLIC_DEVTOOLS_GUARD=off disables it entirely
     • never runs on the landing page itself (that would loop)
     • it navigates only; it does NOT end the session, so a false positive
       costs a student their place on the page, not their login or progress.
───────────────────────────────────────────────────── */

export const BLOCKED_PATH = '/blocked'

const CHECK_INTERVAL_MS     = 2_500
const DEBUGGER_THRESHOLD_MS = 150
const STRIKES_TO_TRIP       = 2

let installed = false
let tripped   = false
let strikes   = 0
let timer: ReturnType<typeof setInterval> | null = null

/* Built through `new Function` on purpose: production minifiers (SWC/Terser)
   drop bare `debugger` statements, so a literal one is stripped from the very
   build where this is meant to run — verified against a real `next build`.
   The minifier cannot see inside the string, so this survives. Returns null
   when a strict CSP forbids eval, in which case heuristic A is simply
   skipped rather than throwing on every tick. */
const runDebugger: (() => void) | null = (() => {
  try { return new Function('debugger') as () => void } catch { return null }
})()

/* The bait object. Its getter fires when the Console panel renders it, which
   is read on the FOLLOWING tick so async panel painting still counts. */
let baitRead = false
const bait: Record<string, unknown> = {}
Object.defineProperty(bait, 'id', {
  get() { baitRead = true; return '' },
  configurable: true,
})

export function guardEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (process.env.NEXT_PUBLIC_DEVTOOLS_GUARD === 'off') return false
  /* Never in dev — the team has to be able to work on the app. */
  if (process.env.NODE_ENV !== 'production') return false
  return true
}

function trip(): void {
  if (tripped) return
  tripped = true
  stopGuard()

  /* Only honoured for script-opened windows; harmless to attempt. */
  try { window.close() } catch { /* ignored */ }

  if (!window.location.pathname.startsWith(BLOCKED_PATH)) {
    /* replace(), not assign(): Back must not return to the protected page. */
    window.location.replace(BLOCKED_PATH)
  }
}

function tick(): void {
  /* A hidden tab is timer-throttled — every timing here would be a lie. */
  if (document.hidden) { strikes = 0; return }

  let suspect = false

  /* A — debugger timing */
  if (runDebugger) {
    const t0 = performance.now()
    runDebugger()
    if (performance.now() - t0 > DEBUGGER_THRESHOLD_MS) suspect = true
  }

  /* B — console getter: did the PREVIOUS tick's bait get rendered? */
  if (baitRead) suspect = true
  baitRead = false
  try {
    console.log(bait)
    console.clear()
  } catch { /* console can be stubbed out; ignore */ }

  strikes = suspect ? strikes + 1 : 0
  if (strikes >= STRIKES_TO_TRIP) trip()
}

export function installDevtoolsGuard(): () => void {
  if (installed || !guardEnabled()) return () => {}
  /* Never arm on the blocked page itself — it would redirect to itself. */
  if (window.location.pathname.startsWith(BLOCKED_PATH)) return () => {}

  installed = true
  timer = setInterval(tick, CHECK_INTERVAL_MS)
  return stopGuard
}

export function stopGuard(): void {
  if (timer) { clearInterval(timer); timer = null }
  installed = false
}
