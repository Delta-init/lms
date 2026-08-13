import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in or create your Delta Institutions account.',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    /* Pinned to the light palette regardless of the stored preference.

       These screens are a brand surface, not app chrome: the split layout is
       built from a solid brand-blue panel with white artwork on it, and its
       right half assumes a light page. Themed halfway it broke badly — the
       panel kept its light background while the text tokens went to the dark
       palette, so "Sign in to your account" turned near-white on near-white.

       Pinning is also the honest behaviour. The preference lives in
       localStorage behind a login, so a first-time visitor has no theme yet,
       and a marketing/auth surface staying on-brand is what people expect.
       data-theme here overrides the value on <html> for this subtree only —
       the dashboard is unaffected. */
    <div data-theme="light" style={{ background: 'var(--color-bg-page)' }}>
      <main className="min-h-screen w-full overflow-hidden">
        {children}
      </main>
    </div>
  )
}
