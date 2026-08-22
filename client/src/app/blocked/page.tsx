import Link from 'next/link'

export const metadata = { title: 'Session paused' }

/* Landing page for the DevTools guard. Deliberately outside the (dashboard)
   group: no sidebar, no data fetching, nothing to inspect. It is essentially
   a blank page with one way back — a truly blank screen reads as "the site
   broke" and generates support tickets instead of the intended message. */
export default function BlockedPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--color-bg-page)' }}>
      <h1
        className="text-lg font-semibold"
        style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
        This page was closed
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        Developer tools were detected while protected course content was open.
        Course videos are watermarked and access is tied to your account.
      </p>
      <Link
        href="/my-learning"
        className="mt-6 rounded-2xl px-5 py-2.5 text-sm font-bold text-white"
        style={{ background: 'var(--color-primary)' }}>
        Back to My Learning
      </Link>
    </main>
  )
}
