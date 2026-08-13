'use client'

import { useState, useEffect } from 'react'
import { FileText, Save, Trash2 } from 'lucide-react'
import { useMyNote, useUpsertNote, useDeleteNote } from '@/lib/api/notes'
import Spinner from '@/components/ui/Spinner'

export function NotesPanel({ lessonId }: { lessonId: string }) {
  const { data: note, isLoading } = useMyNote(lessonId)
  const upsert = useUpsertNote(lessonId)
  const del    = useDeleteNote(lessonId)

  const [body, setBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  /* Sync server note into editor on load / lesson change */
  useEffect(() => {
    setBody(note?.body ?? '')
    setDirty(false)
    setSaved(false)
  }, [note?.body, lessonId])

  const handleChange = (v: string) => {
    setBody(v)
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    if (!body.trim()) return
    await upsert.mutateAsync(body)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const clear = async () => {
    if (!confirm('Delete this note?')) return
    await del.mutateAsync()
    setBody('')
    setDirty(false)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={18} variant="gray" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
          Personal Note
        </p>
        <div className="flex items-center gap-1">
          {note && (
            <button onClick={clear} className="rounded-lg p-1.5 transition-colors hover:bg-[var(--color-hover-danger)]">
              <Trash2 size={12} style={{ color: 'var(--color-danger)' }} />
            </button>
          )}
          <button
            onClick={save}
            disabled={!body.trim() || !dirty || upsert.isPending}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ background: saved ? '#22C55E' : '#0057b8' }}>
            {upsert.isPending
              ? <Spinner size={11} />
              : <Save size={11} />}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      <textarea
        value={body}
        onChange={e => handleChange(e.target.value)}
        placeholder="Type your notes for this lesson here… Only you can see these."
        className="h-64 w-full resize-none rounded-xl px-3 py-2.5 text-xs leading-relaxed outline-none"
        style={{
          background: 'var(--color-bg-inset)',
          border:     `1px solid ${dirty ? '#0057b8' : 'var(--color-border)'}`,
          color: 'var(--color-text-primary)',
        }}
      />

      {note?.updatedAt && (
        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          Last saved {new Date(note.updatedAt).toLocaleString()}
        </p>
      )}

      {!body.trim() && !isLoading && (
        <div className="py-2 text-center">
          <FileText size={20} className="mx-auto mb-1.5" style={{ color: 'var(--color-border)' }} />
          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            Start typing to create a note for this lesson.
          </p>
        </div>
      )}
    </div>
  )
}
