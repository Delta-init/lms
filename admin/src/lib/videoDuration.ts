'use client'

/* ─────────────────────────────────────────────────────
   videoDuration — read a video's length without uploading or
   fully downloading it.

   A detached <video preload="metadata"> makes the browser fetch only the
   header (the moov atom for MP4), or read it straight off disk when handed
   a File via an object URL. Either way the answer arrives in milliseconds
   and costs no server work — which is why lesson duration no longer needs
   to be typed in by hand.

   Returns null rather than throwing when the container is one the browser
   cannot parse (MKV and some AVI variants), so callers can simply fall back
   to leaving the duration unset.
───────────────────────────────────────────────────── */

export function probeVideoDuration(src: string, timeoutMs = 15_000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(null); return }

    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted   = true

    let settled = false
    const finish = (secs: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      /* release the decoder/connection immediately */
      video.removeAttribute('src')
      try { video.load() } catch { /* no-op */ }
      resolve(secs)
    }

    const timer = setTimeout(() => finish(null), timeoutMs)

    video.addEventListener('loadedmetadata', () => {
      const d = video.duration
      finish(Number.isFinite(d) && d > 0 ? d : null)
    })
    video.addEventListener('error', () => finish(null))

    video.src = src
  })
}

/** Duration of a locally-picked file — no network involved. */
export async function probeFileDuration(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file)
  try {
    return await probeVideoDuration(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Seconds → whole minutes, never rounding a real video down to "unknown". */
export function secondsToMinutes(secs: number): number {
  return Math.max(1, Math.round(secs / 60))
}
