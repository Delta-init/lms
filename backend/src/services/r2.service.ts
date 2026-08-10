import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs/promises'
import { env } from '@/config/env.ts'

/* ── R2 configured? ─────────────────────────────────────────── */
export function isR2Configured(): boolean {
  return !!(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_PUBLIC_URL
  )
}

/* ── S3 client (Cloudflare R2 is S3-compatible) ───────────────
   Only created when R2 credentials are present.
────────────────────────────────────────────────────────────── */
let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }
  return _client
}

/* ── Key helpers ─────────────────────────────────────────────── */
export function makeKey(originalName: string, folder = 'misc'): string {
  const ext    = path.extname(originalName).toLowerCase()
  const random = crypto.randomBytes(8).toString('hex')
  return `${folder}/${Date.now()}-${random}${ext}`
}

export function getPublicUrl(key: string): string {
  return `${env.R2_PUBLIC_URL}/${key}`
}

/* ── Local-disk fallback (when R2 is not configured) ────────── */
async function saveToLocalDisk(buffer: Buffer, key: string): Promise<string> {
  const localPath = path.join(process.cwd(), 'uploads', key)
  await fs.mkdir(path.dirname(localPath), { recursive: true })
  await fs.writeFile(localPath, buffer)
  return `${env.BACKEND_PUBLIC_URL}/uploads/${key}`
}

/* ── Unified upload — R2 when configured, local disk otherwise ─ */
export async function uploadFile(
  buffer:      Buffer,
  key:         string,
  contentType: string,
): Promise<string> {
  if (isR2Configured()) return uploadToR2(buffer, key, contentType)
  return saveToLocalDisk(buffer, key)
}

/* ── Upload buffer directly to R2 ───────────────────────────── */
export async function uploadToR2(
  buffer:      Buffer,
  key:         string,
  contentType: string,
): Promise<string> {
  const client = getClient()
  await client.send(
    new PutObjectCommand({
      Bucket:      env.R2_BUCKET_NAME,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }),
  )
  return getPublicUrl(key)
}

/* ── Generate a presigned PUT URL (client → R2 direct upload) ─ */
export async function generatePresignedPutUrl(
  key:         string,
  contentType: string,
  expiresIn = 3600, // 1 hour
): Promise<{ presignedUrl: string; publicUrl: string; key: string }> {
  const client = getClient()
  const command = new PutObjectCommand({
    Bucket:      env.R2_BUCKET_NAME,
    Key:         key,
    ContentType: contentType,
  })
  const presignedUrl = await getSignedUrl(client, command, { expiresIn })
  return { presignedUrl, publicUrl: getPublicUrl(key), key }
}

/* ── Gated reads (H-11) ──────────────────────────────────────
   KYC scans must never be served from a permanent public URL.

   ⚠️ R2_PUBLIC_URL is a `pub-*.r2.dev` host, which exposes the ENTIRE bucket.
   There is no per-prefix ACL on that domain, so a prefix alone gates nothing
   in R2 — the scans need a bucket with no public access.

   R2_KYC_BUCKET_NAME names that private bucket. Reads are signed against it
   and expire; nothing ever hands out a public URL for these objects. When it
   is not configured we fall back to the main bucket and warn loudly, because
   that leaves the object publicly reachable and H-11 is NOT closed.
────────────────────────────────────────────────────────────── */
export const KYC_PREFIX = 'kyc/'

/** The bucket holding identity scans. Must have public access disabled. */
export function kycBucket(): string {
  return process.env['R2_KYC_BUCKET_NAME']?.trim() || env.R2_BUCKET_NAME
}

/** True when identity scans are stored somewhere genuinely private. */
export function isKycStoragePrivate(): boolean {
  if (!isR2Configured()) return true          /* local disk — blocked in app.ts */
  const dedicated = process.env['R2_KYC_BUCKET_NAME']?.trim()
  return !!dedicated && dedicated !== env.R2_BUCKET_NAME
}

/** Store an identity scan. Returns the bare storage KEY, never a URL — a key
 *  that leaks from the database is not something a browser can fetch. */
export async function uploadKycFile(
  buffer:      Buffer,
  key:         string,
  contentType: string,
): Promise<string> {
  if (!isR2Configured()) {
    await saveToLocalDisk(buffer, key)
    return key
  }
  await getClient().send(
    new PutObjectCommand({
      Bucket:      kycBucket(),
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }),
  )
  return key
}

/** True when the stored URL points at a gated KYC object. */
export function isKycUrl(url: string): boolean {
  return keyFromUrl(url)?.startsWith(KYC_PREFIX) ?? false
}

/** Recover the storage key from a stored absolute URL.
 *  Handles both the R2 public host and the local-disk `/uploads/<key>` form.
 *  Returns null when the URL is not one of ours. */
export function keyFromUrl(url: string): string | null {
  if (!url) return null
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url.startsWith('/') ? url : `/${url}`
  }
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, '')
  const key = decoded.startsWith('uploads/') ? decoded.slice('uploads/'.length) : decoded
  /* Refuse traversal outright — the key is used to address storage. */
  if (!key || key.includes('..')) return null
  return key
}

/** Short-lived signed GET for a private object. R2 only. */
export async function generatePresignedGetUrl(key: string, expiresIn = 300): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: key.startsWith(KYC_PREFIX) ? kycBucket() : env.R2_BUCKET_NAME,
    Key:    key,
  })
  return getSignedUrl(getClient(), command, { expiresIn })
}

/** True when the object is really there. Used by the KYC migration to tell a
 *  reference whose object is MISSING from one that is merely un-migrated —
 *  those read identically from the database and mean very different things. */
export async function objectExists(key: string, bucket = env.R2_BUCKET_NAME): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}

/** Server-side copy, used by the KYC migration to relocate existing scans. */
export async function copyToKycBucket(sourceKey: string, destKey: string): Promise<void> {
  await getClient().send(
    new CopyObjectCommand({
      Bucket:     kycBucket(),
      CopySource: `${env.R2_BUCKET_NAME}/${sourceKey}`,
      Key:        destKey,
    }),
  )
}

/* ── Delete an object from R2 ───────────────────────────────── */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getClient()
  await client.send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key:    key,
    }),
  )
}
