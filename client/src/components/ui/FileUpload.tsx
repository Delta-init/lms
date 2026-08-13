'use client'

import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence }        from 'framer-motion'
import { Upload, X, CheckCircle2, Film, Image as ImageIcon, AlertCircle } from 'lucide-react'
import { useImageUpload, usePresignedUpload } from '@/lib/api/upload'

/* ── Types ─────────────────────────────────────────────────── */
export type FileUploadType = 'image' | 'video' | 'any'

interface FileUploadProps {
  /** Called with the final public CDN URL when upload completes */
  onUpload:    (url: string, key: string) => void
  /** Optional existing value to show as current file */
  value?:      string
  type?:       FileUploadType
  /** Max size in bytes. Defaults: 5MB for images, 500MB for videos */
  maxSize?:    number
  label?:      string
  className?:  string
  disabled?:   boolean
}

const ACCEPT: Record<FileUploadType, string> = {
  image: 'image/jpeg,image/png,image/gif,image/webp',
  video: 'video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska',
  any:   'image/*,video/*',
}

const DEFAULT_MAX: Record<FileUploadType, number> = {
  image: 5  * 1024 * 1024,   // 5 MB
  video: 500 * 1024 * 1024,  // 500 MB
  any:   500 * 1024 * 1024,
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

/* ── Component ──────────────────────────────────────────────── */
export function FileUpload({
  onUpload,
  value,
  type = 'any',
  maxSize,
  label,
  className = '',
  disabled = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver,  setDragOver]  = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [preview,   setPreview]   = useState<string | null>(value ?? null)
  const [error,     setError]     = useState<string | null>(null)
  const [uploaded,  setUploaded]  = useState(false)

  const imageUpload   = useImageUpload()
  const presignUpload = usePresignedUpload()

  const isUploading = imageUpload.isPending || presignUpload.isPending
  const limit       = maxSize ?? DEFAULT_MAX[type]

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    setUploaded(false)

    if (file.size > limit) {
      setError(`File too large. Max size is ${formatBytes(limit)}.`)
      return
    }

    // Show image preview immediately
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (e) => setPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    }

    try {
      if (file.type.startsWith('image/') && type !== 'video') {
        const result = await imageUpload.mutateAsync(file)
        setPreview(result.url)
        setUploaded(true)
        onUpload(result.url, result.key)
      } else {
        setProgress(0)
        const result = await presignUpload.mutateAsync({
          file,
          folder: file.type.startsWith('video/') ? 'videos' : 'uploads',
          onProgress: (pct) => setProgress(pct),
        })
        setPreview(result.publicUrl)
        setUploaded(true)
        onUpload(result.publicUrl, result.key)
      }
    } catch (err) {
      setError((err as Error).message ?? 'Upload failed. Please try again.')
      setPreview(null)
    }
  }, [imageUpload, presignUpload, onUpload, limit, type])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const clear = () => {
    setPreview(null)
    setUploaded(false)
    setError(null)
    setProgress(0)
  }

  const TypeIcon = type === 'image' ? ImageIcon : type === 'video' ? Film : Upload

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !isUploading) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={disabled || isUploading ? undefined : onDrop}
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        className="relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all"
        style={{
          borderColor: dragOver ? '#0057b8' : error ? '#EF4444' : 'var(--color-border)',
          background:  dragOver ? 'rgba(0,87,184,0.04)' : 'var(--color-bg-subtle)',
          cursor:      disabled || isUploading ? 'default' : 'pointer',
          opacity:     disabled ? 0.6 : 1,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[type]}
          onChange={onInputChange}
          className="hidden"
          disabled={disabled || isUploading}
        />

        <AnimatePresence mode="wait">
          {/* ── Uploading state ── */}
          {isUploading && (
            <motion.div key="uploading"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="flex w-full flex-col items-center gap-3 px-6 py-4">
              <div className="h-10 w-10 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(0,87,184,0.1)' }}>
                <Upload size={20} style={{ color: 'var(--color-primary)' }} className="animate-bounce" />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>Uploading…</p>
              {/* Progress bar — shown for presigned video uploads */}
              {presignUpload.isPending && (
                <div className="w-full max-w-[240px] overflow-hidden rounded-full h-1.5"
                  style={{ background: 'var(--color-border)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'var(--color-primary)' }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
              {presignUpload.isPending && (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{progress}%</p>
              )}
            </motion.div>
          )}

          {/* ── Success / preview state ── */}
          {!isUploading && uploaded && preview && (
            <motion.div key="success"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="relative w-full p-3">
              {preview.startsWith('data:image') || preview.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                <img src={preview} alt="Uploaded" className="mx-auto max-h-[120px] rounded-xl object-cover" />
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-xl py-4"
                  style={{ background: 'rgba(0,87,184,0.06)' }}>
                  <Film size={20} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>Video uploaded</span>
                </div>
              )}
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>Upload complete</span>
              </div>
              {!disabled && (
                <button
                  onClick={(e) => { e.stopPropagation(); clear() }}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-hover-danger)]"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <X size={12} />
                </button>
              )}
            </motion.div>
          )}

          {/* ── Idle / drag state ── */}
          {!isUploading && !uploaded && (
            <motion.div key="idle"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 px-6 py-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
                style={{ background: dragOver ? 'rgba(0,87,184,0.12)' : 'rgba(0,87,184,0.08)' }}>
                <TypeIcon size={20} style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {dragOver ? 'Drop to upload' : 'Drag & drop or click to browse'}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {type === 'image' && 'JPEG, PNG, GIF, WebP, max 5 MB'}
                  {type === 'video' && 'MP4, WebM, MOV, AVI, MKV, max 500 MB'}
                  {type === 'any'   && `Images (5 MB) or Videos (500 MB)`}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Error message ── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--color-danger)' }}>
            <AlertCircle size={12} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
