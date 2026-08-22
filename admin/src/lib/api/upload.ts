'use client'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* ── Types ─────────────────────────────────────────────────── */
export interface UploadImageResult {
  url:  string
  key:  string
  size: number
}

export interface PresignResult {
  presignedUrl: string
  publicUrl:    string
  key:          string
}

/* Client-side ceiling. Advisory only — a presigned PUT is signed before the
   bytes exist, so the real enforcement is R2's own 5 GB single-PUT limit.
   This exists to fail fast in the UI instead of after a long upload. */
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024   // 2 GB

/* Mirrors backend ALLOWED_VIDEO (middleware/upload.middleware.ts) */
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4:  'video/mp4',
  m4v:  'video/mp4',
  webm: 'video/webm',
  mov:  'video/quicktime',
  avi:  'video/x-msvideo',
  mkv:  'video/x-matroska',
}

/* The browser leaves `file.type` EMPTY for some containers (.mkv and .avi are
   the usual offenders, and any file whose extension the OS doesn't know).
   An empty type fails presign validation, and — worse — a type that differs
   between signing and PUT makes R2 reject the upload with
   SignatureDoesNotMatch, which surfaces as an opaque CORS error. So resolve
   it ONCE here and use the same value for both calls. */
export function resolveVideoContentType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mapped = VIDEO_MIME_BY_EXT[ext]
  if (mapped) return mapped
  throw new Error(
    `Could not identify "${file.name}" as a video. Supported formats: MP4, WebM, MOV, AVI, MKV.`,
  )
}

/* ── Image: backend receives file → uploads to R2 → returns CDN URL ── */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ success: true; data: UploadImageResult }>(
    '/uploads/image',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data.data.url
}

/* ── Presign: backend returns PUT URL → client uploads directly to R2 ── */
export async function getPresignedUrl(
  filename:    string,
  contentType: string,
  folder = 'uploads',
): Promise<PresignResult> {
  const res = await api.post<{ success: true; data: PresignResult }>(
    '/uploads/presign',
    { filename, contentType, folder },
  )
  return res.data.data
}

/* ── Upload a file directly to R2 via presigned URL (with progress) ──
   Raw File as the body — never FormData: a presigned PUT stores the request
   body verbatim, so a multipart wrapper would corrupt the object. No
   Authorization header either; the signature in the query string is the
   credential, and an extra auth header makes R2 reject the request. */
export async function uploadToR2Direct(
  presignedUrl: string,
  file:         File,
  onProgress?:  (pct: number) => void,
  opts?:        { contentType?: string; signal?: AbortSignal },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presignedUrl)
    /* MUST be byte-identical to the Content-Type that was signed */
    xhr.setRequestHeader('Content-Type', opts?.contentType ?? file.type)

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      })
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve() }
      else if (xhr.status === 403) {
        reject(new Error('Storage rejected the upload (link expired or file type changed). Please try again.'))
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status}). Please try again.`))
      }
    })
    xhr.addEventListener('error', () => reject(new Error(
      'Network error during upload. Check your connection and try again.',
    )))
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')))

    if (opts?.signal) {
      if (opts.signal.aborted) { xhr.abort(); return }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(file)
  })
}

/* ── Video: presigned direct upload to R2 ────────────────────
   No transcode step. The MP4/WebM is served straight from the CDN and the
   player streams it with HTTP range requests, so seeking works without an
   HLS ladder. That removes a blocking server-side FFmpeg job (~13 s for a
   small file, minutes for a large one, capped at 2 concurrent jobs) from
   every single upload — the video is ready the instant the PUT returns.

   Lessons created before this change still hold master.m3u8 URLs; those
   files remain in the bucket and keep playing, so the change is backward
   compatible. ── */
export async function uploadVideo(
  file:        File,
  onProgress?: (pct: number) => void,
  opts?:       { signal?: AbortSignal },
): Promise<string> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB — the maximum is 2 GB.`,
    )
  }
  const contentType = resolveVideoContentType(file)
  const result = await getPresignedUrl(file.name, contentType, 'videos')
  await uploadToR2Direct(result.presignedUrl, file, onProgress, { contentType, signal: opts?.signal })
  return result.publicUrl
}

/* ── React Query hooks ── */
export function useUploadImage() {
  return useMutation({
    mutationFn: (file: File) => uploadImage(file),
  })
}

export function useUploadVideo(onProgress?: (pct: number) => void) {
  return useMutation({
    mutationFn: (file: File) => uploadVideo(file, onProgress),
  })
}
