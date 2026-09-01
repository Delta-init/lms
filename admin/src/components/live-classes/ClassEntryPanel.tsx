'use client'

import { useCallback, useState } from 'react'
import { AlertTriangle, Radio, Loader2, Eye, EyeOff } from 'lucide-react'
import { useCurrentUser } from '@/lib/api/user'
import { redirectToClass, handoffError } from '@/lib/joinClass'

/* ─────────────────────────────────────────────────────
   ClassEntryPanel — the door from the admin panel into a class.
   ─────────────────────────────────────────────────────
   Replaces LiveKitStudio, which used to build the room here. The room now
   lives on the meeting platform, so this page's whole job is to decide HOW
   someone enters and then get out of the way.

   The visibility choice stays on THIS side. It is the LMS's decision to make
   — CLT only honours it — so it is made before the handoff and travels with
   it. Inside the room an admin can change their mind, but only because the
   ticket said they may.

   TWO KINDS OF HOST arrive here:

     the assigned instructor — publishes, moderates, always visible
     admin staff            — oversight, and chooses whether the room can see
                              them at all

   Hidden is the default and wears the primary button, because watching a
   class must not be indistinguishable from taking part in it.
───────────────────────────────────────────────────── */
export function ClassEntryPanel({ liveClassId, title, instructorId }: {
  liveClassId:  string
  title:        string
  /** Who owns this class. Decides whether the visibility choice is offered at
      all: it is meaningless for the instructor, who is always seen. */
  instructorId: string
}) {
  const { data: me } = useCurrentUser()
  const isAssignedInstructor = !!me && me.id === instructorId

  const [pending, setPending] = useState<'hidden' | 'visible' | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const enter = useCallback(async (visible: boolean) => {
    setPending(visible ? 'visible' : 'hidden')
    setError(null)
    try {
      await redirectToClass(liveClassId, { visible })
      /* On success the browser is already leaving; the spinner stays up so
         nothing flickers back to an idle button during the navigation. */
    } catch (err) {
      setError(handoffError(err))
      setPending(null)
    }
  }, [liveClassId])

  const busy = pending !== null

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl px-6 py-16 text-center"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(139,92,246,0.15)' }}>
        <Radio size={22} style={{ color: '#A78BFA' }} />
      </div>

      <div>
        <h2 className="text-base font-bold text-white">{title}</h2>
        <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Interactive room · opens on the meeting platform
        </p>
      </div>

      {error && (
        <div className="flex max-w-md items-start gap-2 rounded-xl px-3 py-2 text-left text-xs"
          style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#FCA5A5' }}>
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isAssignedInstructor ? (
        <button
          onClick={() => enter(true)}
          disabled={busy}
          className="flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7C3AED, #A78BFA)' }}>
          {busy ? <><Loader2 size={15} className="animate-spin" />Opening…</>
                : <><Radio size={15} />Start the room</>}
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => enter(false)}
              disabled={busy}
              className="flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #A78BFA)' }}>
              {pending === 'hidden'
                ? <><Loader2 size={15} className="animate-spin" />Opening…</>
                : <><EyeOff size={15} />Watch hidden</>}
            </button>

            <button
              onClick={() => enter(true)}
              disabled={busy}
              className="flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all disabled:opacity-50"
              style={{ background: 'rgba(251,191,36,0.12)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.32)' }}>
              {pending === 'visible'
                ? <><Loader2 size={15} className="animate-spin" />Opening…</>
                : <><Eye size={15} />Join visibly</>}
            </button>
          </div>

          <p className="max-w-sm text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.30)' }}>
            <strong style={{ color: 'rgba(255,255,255,0.45)' }}>Hidden</strong> — you see and hear the class,
            but you are absent from the participant list and cannot speak.
            <br />
            <strong style={{ color: 'rgba(255,255,255,0.45)' }}>Visible</strong> — you appear by name and can speak or
            share. You can switch either way once inside.
          </p>
        </>
      )}

      {isAssignedInstructor && (
        <p className="max-w-sm text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Students who have booked this class can join once you start.
        </p>
      )}
    </div>
  )
}
