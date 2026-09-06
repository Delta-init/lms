/**
 * Public asset proxy — serves NON-protected files (avatars, images, uploaded
 * documents) streamed from the now-private R2 bucket, so making the bucket
 * private for video protection doesn't break site images.
 *
 * Mounted OUTSIDE /api/v1 (no rate limit, like the static /uploads mount).
 * Paid videos and KYC scans are refused here — they are only reachable via
 * their dedicated signed-URL paths.
 */
import { Router, type Request, type Response } from 'express'
import { getObjectBytes } from '@/services/r2.service.ts'

const router = Router()

const BLOCKED_PREFIXES = ['videos/', 'kyc/']

router.get('/*', async (req: Request, res: Response): Promise<void> => {
  const key = decodeURIComponent(req.path).replace(/^\/+/, '')
  if (!key || key.includes('..')) { res.status(400).end(); return }
  if (BLOCKED_PREFIXES.some(p => key.startsWith(p))) { res.status(403).end(); return }

  const obj = await getObjectBytes(key)
  if (!obj) { res.status(404).end(); return }

  res.setHeader('Content-Type', obj.contentType ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.end(Buffer.from(obj.body))
})

export default router
