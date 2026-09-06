import { env } from '@/config/env.ts'

/**
 * Rewrites a stored R2 *public* URL (pub-….r2.dev/<key>) to the LMS asset
 * proxy, which streams the object from the now-private bucket. Leaves anything
 * else untouched (local /uploads, external avatars, empty values).
 *
 * Protected prefixes (paid videos, KYC scans) are never rewritten to the public
 * proxy — the proxy refuses them too, but not emitting the URL keeps them out
 * of API responses entirely.
 */
const PROTECTED_PREFIXES = ['videos/', 'kyc/']

export function toAssetUrl<T extends string | undefined | null>(url: T): T {
  if (!url || !url.includes('.r2.dev')) return url
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return url
  }
  const key = decodeURIComponent(pathname).replace(/^\/+/, '')
  if (!key || key.includes('..')) return url
  if (PROTECTED_PREFIXES.some(p => key.startsWith(p))) return url
  return `${env.BACKEND_PUBLIC_URL.replace(/\/+$/, '')}/assets/${key}` as T
}
