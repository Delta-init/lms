'use client'

/**
 * TranscriptEditor
 * ─────────────────
 * Shown inside the lesson edit form (ModulesSection).
 * Lets instructors manually write/paste a transcript OR click
 * "Generate with AI" to auto-produce one via Ollama.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlignLeft, Sparkles, Check, ChevronDown } from 'lucide-react'
import { useSaveTranscript, useGenerateTranscript } from '@/lib/api/outline'
import Spinner from '@/components/ui/Spinner'

interface Props {
  lessonId:    string
  initialText: string | undefined
}

export function TranscriptEditor({ lessonId, initialText }: Props) {
  const [open,  setOpen]  = useState(false)
  const [text,  setText]  = useState(initialText ?? '')
  const [saved, setSaved] = useState(false)

  /* Sync if the parent lesson changes */
  useEffect(() => { setText(initialText ?? '') }, [initialText])

  const save     = useSaveTranscript(lessonId)
  const generate = useGenerateTranscript(lessonId)

  const handleSave = async () => {
    await save.mutateAsync(text)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleGenerate = async () => {
    const result = await generate.mutateAsync()
    setText(result)
  }

  const charCount = text.length
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.18)' }}>

      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-white/[0.03]">
        <AlignLeft size={13} style={{ color: '#6366F1', flexShrink: 0 }} />
        <span className="flex-1 text-left text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Transcript
        </span>
        {text && (
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {wordCount.toLocaleString()} words
          </span>
        )}
        <ChevronDown size={13}
          style={{
            color: 'rgba(255,255,255,0.3)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="transcript-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}>
            <div className="space-y-2.5 px-3.5 pb-3.5 pt-1"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>

              {/* Textarea */}
              <textarea
                value={text}
                onChange={e => { setText(e.target.value); setSaved(false) }}
                placeholder="Paste or type the lesson transcript here…&#10;&#10;Click 'Generate with AI' to auto-produce one from the lesson content."
                rows={8}
                className="w-full resize-y rounded-lg px-3 py-2 text-xs text-white outline-none transition-all placeholder:opacity-25 leading-relaxed"
                style={{
                  background: 'rgba(0,0,0,0.28)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  fontFamily: 'inherit',
                  minHeight: 120,
                }}
                onFocus={e  => { e.currentTarget.style.border = '1px solid rgba(99,102,241,0.5)' }}
                onBlur={e   => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.09)' }}
              />

              {/* Stats + actions */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {charCount.toLocaleString()} chars · {wordCount.toLocaleString()} words
                </p>

                <div className="flex items-center gap-1.5">
                  {/* AI generate */}
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generate.isPending || save.isPending}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-50"
                    style={{
                      background: 'rgba(99,102,241,0.14)',
                      border: '1px solid rgba(99,102,241,0.28)',
                      color: '#818CF8',
                    }}>
                    {generate.isPending
                      ? <><Spinner size={10} />Generating…</>
                      : <><Sparkles size={10} />Generate with AI</>}
                  </button>

                  {/* Save */}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={save.isPending || generate.isPending || !text.trim()}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-white transition-all disabled:opacity-40"
                    style={{
                      background: saved
                        ? 'rgba(74,222,128,0.18)'
                        : 'linear-gradient(135deg, rgba(99,102,241,0.85), rgba(129,140,248,0.85))',
                      border: saved ? '1px solid rgba(74,222,128,0.35)' : '1px solid transparent',
                      color: saved ? '#4ADE80' : 'white',
                    }}>
                    {save.isPending
                      ? <><Spinner size={10} />Saving…</>
                      : saved
                        ? <><Check size={10} />Saved</>
                        : 'Save'}
                  </button>
                </div>
              </div>

              {/* AI generation error */}
              {generate.isError && (
                <p className="text-[11px]" style={{ color: '#EF4444' }}>
                  {(generate.error as { response?: { data?: { error?: { message?: string } } } })
                    ?.response?.data?.error?.message ?? 'Generation failed. Is Ollama running?'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
