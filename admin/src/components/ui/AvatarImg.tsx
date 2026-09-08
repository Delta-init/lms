'use client'

import { useCallback, useState } from 'react'

/* ─────────────────────────────────────────────────────
   The inside of an avatar frame: the photo, or the person's initial when
   there is no photo — or when the photo fails to load.

   Every avatar in the app was a bare `<img src={user.avatarUrl}>` with the
   initials fallback behind a `? :` on whether avatarUrl was set. That covers
   "no photo" but not "photo that no longer resolves", which is the case that
   actually happens: an expired CDN link, a moved object, or a bucket whose
   public access was switched off. The browser then paints its own
   broken-image glyph inside a round frame, and it reads as a rendering bug
   rather than a missing profile picture.

   A dead link should look exactly like no link. Two things are needed for
   that, and only having the first is why this looked fixed when it was not:

     · `onError`, for a failure that happens while the page is open;

     · a check when the node mounts, for a failure that already happened.
       The browser starts fetching as soon as it parses the server-rendered
       HTML, so a URL that fails FAST — a 401 from a bucket that is no longer
       public — has errored before React hydrated and attached the handler.
       The event fires into a void. Measured, not assumed: the element
       reported `complete: true, naturalWidth: 0` while a fresh probe of the
       same URL still fired `error` normally. A decoded image has a non-zero
       naturalWidth; a finished-but-broken one does not.

   The failure is stored as the src that failed rather than a boolean, so a
   new photo un-fails on its own. A `useEffect` reset keyed on src would run
   AFTER the mount-time check and silently undo it — which it did.
───────────────────────────────────────────────────── */
export function AvatarImg({
  src,
  name,
  className = '',
  fallbackClassName = '',
  fallbackStyle,
  fallback,
}: {
  src?: string | null
  name?: string | null
  /** Applied to the <img> when the photo loads. */
  className?: string
  /** Applied to the <span> that shows the initial instead. */
  fallbackClassName?: string
  fallbackStyle?: React.CSSProperties
  /* Whatever this avatar already showed when there was no photo. Call sites
     differ more than they look: a one-letter span, a two-letter monogram with
     a colour picked from the name, a graduation-cap icon, or a bare string
     rendered by the parent frame. Passing the existing markup through keeps
     every one of them looking exactly as it did — this component is only
     changing WHEN the fallback appears, never what it is. */
  fallback?: React.ReactNode
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = !!src && failedSrc === src

  const check = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth === 0) setFailedSrc(src ?? null)
  }, [src])

  if (!src || failed) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span className={fallbackClassName} style={fallbackStyle}>
        {(name ?? '').trim()[0]?.toUpperCase() ?? '?'}
      </span>
    )
  }

  return (
    <img
      ref={check}
      src={src}
      alt=""
      onError={() => setFailedSrc(src ?? null)}
      className={className}
    />
  )
}
