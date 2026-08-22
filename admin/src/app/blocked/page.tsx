import Link from 'next/link'

export const metadata = { title: 'Session paused' }

/* Landing page for the DevTools guard — deliberately outside the (dashboard)
   group so it carries no nav, no data and nothing to inspect. */
export default function BlockedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: '#080A12' }}>
      <h1 className="text-lg font-semibold text-white">This page was closed</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Developer tools were detected while the admin panel was open. If you are
        a developer, set <code>NEXT_PUBLIC_DEVTOOLS_GUARD=off</code> for this
        environment.
      </p>
      <Link href="/"
        className="mt-6 rounded-2xl px-5 py-2.5 text-sm font-bold text-white"
        style={{ background: '#0057b8' }}>
        Back to dashboard
      </Link>
    </main>
  )
}
