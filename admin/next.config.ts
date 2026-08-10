import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

/* Backend origin — used only server-side for the rewrite proxy.
   NOT a NEXT_PUBLIC var; never sent to the browser.              */
const API_ORIGIN = process.env.API_URL ?? 'http://localhost:8000'

/* Parse the R2 public URL (set at build time via NEXT_PUBLIC_R2_PUBLIC_URL). */
const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''
const r2Hostname  = r2PublicUrl
  ? (() => { try { return new URL(r2PublicUrl).hostname } catch { return '' } })()
  : ''

type RemotePattern = { protocol: 'https' | 'http'; hostname: string; port?: string; pathname?: string }

/* Only the exact bucket host from NEXT_PUBLIC_R2_PUBLIC_URL is allowed.
   Wildcards such as *.r2.dev would let anyone with a free Cloudflare account
   feed arbitrary bytes to the image optimizer on our own origin. */
const r2Patterns: RemotePattern[] = [
  ...(r2Hostname ? [{ protocol: 'https' as const, hostname: r2Hostname }] : []),
]

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      // Local disk fallback (dev only — when R2 is not configured)
      { protocol: 'http', hostname: 'localhost', port: '8000' },
      ...r2Patterns,
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  /* Proxy /api/v1/* → backend so the browser never calls a different origin.
     This means cookies work as same-origin (no CORS, no SameSite issues).  */
  async rewrites() {
    return [
      {
        source:      '/api/v1/:path*',
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
      {
        source:      '/uploads/:path*',
        destination: `${API_ORIGIN}/uploads/:path*`,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent:  !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    automaticVercelMonitors: false,
  },
})
