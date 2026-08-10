import multer, { type FileFilterCallback } from 'multer'
import type { Request } from 'express'

/* ── Memory storage ────────────────────────────────────────────
   Files land in req.file.buffer — the route handler streams
   them to Cloudflare R2.  Nothing touches local disk.
────────────────────────────────────────────────────────────── */

/* ── Image upload ───────────────────────────────────────────── */
export const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/* ── Document upload (enrollment forms — images + PDF) ───────── */
export const ALLOWED_DOCUMENT = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits:  {
    fileSize:      10 * 1024 * 1024, // 10 MB
    files:         1,
    fields:        10,
    fieldNameSize: 200,
    parts:         10,
  },
  fileFilter: (_req: Request, file, cb: FileFilterCallback) => {
    if (ALLOWED_DOCUMENT.has(file.mimetype)) cb(null, true)
    else cb(new Error('Only JPEG, PNG, WebP images or PDF documents are allowed'))
  },
})

/* ── Pre-registration document upload (M-05) ─────────────────
   Same accepted types as documentUpload, but 3 MB rather than 10 — matching
   the ceiling the signup form already enforces in the browser — because this
   is the one upload path with no account behind it. Everything a signup can
   legitimately send fits well inside it.
────────────────────────────────────────────────────────────── */
export const SIGNUP_DOC_MAX_BYTES = 3 * 1024 * 1024

export const signupDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits:  {
    fileSize:      SIGNUP_DOC_MAX_BYTES,
    files:         1,
    fields:        5,
    fieldNameSize: 200,
    parts:         6,
  },
  fileFilter: (_req: Request, file, cb: FileFilterCallback) => {
    if (ALLOWED_DOCUMENT.has(file.mimetype)) cb(null, true)
    else cb(new Error('Only JPEG, PNG, WebP images or PDF documents are allowed'))
  },
})

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits:  {
    fileSize:      5 * 1024 * 1024, // 5 MB
    files:         1,
    fields:        10,
    fieldNameSize: 200,
    parts:         10,
  },
  fileFilter: (_req: Request, file, cb: FileFilterCallback) => {
    if (ALLOWED_IMAGE.has(file.mimetype)) cb(null, true)
    else cb(new Error('Only JPEG, PNG, GIF or WebP images are allowed'))
  },
})

/* ── Magic-byte verification ────────────────────────────────────
   fileFilter only sees the client-supplied multipart part header,
   so the declared MIME type is re-checked against the real leading
   bytes of the buffer before anything is stored.
────────────────────────────────────────────────────────────── */
const SIGNATURES: Record<string, (buf: Buffer) => boolean> = {
  'image/jpeg':      buf => buf.length >= 3  && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/png':       buf => buf.length >= 4  && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  'image/gif':       buf => buf.length >= 4  && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38,
  'image/webp':      buf => buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP',
  'application/pdf': buf => buf.length >= 4  && buf.toString('latin1', 0, 4) === '%PDF',
}

/** True when the buffer's leading bytes really match the declared MIME type. */
export function verifyFileSignature(buffer: Buffer, mimetype: string): boolean {
  const check = SIGNATURES[mimetype]
  return check ? check(buffer) : false
}

/* ── Storage name derived from the VERIFIED MIME type ─────────
   Never trust file.originalname for the stored extension.
────────────────────────────────────────────────────────────── */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg':      '.jpg',
  'image/png':       '.png',
  'image/gif':       '.gif',
  'image/webp':      '.webp',
  'application/pdf': '.pdf',
}

export function safeUploadName(mimetype: string): string {
  return `upload${EXT_BY_MIME[mimetype] ?? ''}`
}

/* ── Video MIME validator ───────────────────────────────────────
   Videos are NOT buffered through the backend — the route
   handler issues a presigned PUT URL so the client uploads
   directly to R2.  This multer instance is kept for optional
   MIME-type pre-validation on small metadata-only requests.
────────────────────────────────────────────────────────────── */
export const ALLOWED_VIDEO = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',    // .mov
  'video/x-msvideo',   // .avi
  'video/x-matroska',  // .mkv
])
