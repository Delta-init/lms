import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ?? process.env.NEXT_PUBLIC_API_BASE_URL
  ?? 'http://localhost:4000'

/* Parse the R2 public URL (set at build time via NEXT_PUBLIC_R2_PUBLIC_URL).
   Falls back to allowing all *.r2.dev subdomains for local dev.           */
const r2PublicUrl  = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''
const r2Hostname   = r2PublicUrl
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
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
      // Local disk fallback (dev only — when R2 is not configured)
      { protocol: 'http', hostname: 'localhost', port: '8000' },
      ...r2Patterns,
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  // Proxy /api/v1/* → backend so client never hard-codes the backend URL
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_BASE}/api/v1/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${API_BASE}/uploads/:path*`,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  // Sentry org + project are optional — needed only for source-map uploads.
  // Set SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN in .env to enable.
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Suppress Sentry build-time output unless CI is running
  silent: !process.env.CI,

  // Upload wider sourcemaps (includes vendor code)
  widenClientFileUpload: true,

  // Tree-shake the Sentry logger in production
  disableLogger: true,

  // Don't instrument Vercel Cron Monitors (not used)
  automaticVercelMonitors: false,
})
