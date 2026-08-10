'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* ─────────────────────────────────────────────────────
   Post-class assignments — the student's side.

   NOTE the prefix: /class-assignments, not /assignments. The latter is the
   older lesson-level assignment feature and is a different thing entirely.
───────────────────────────────────────────────────── */

export type ClassAssignmentStatus = 'pending' | 'approved' | 'rejected'

export interface AssignmentFile {
  url:       string
  name:      string
  mimeType:  string
  sizeBytes: number
}

interface Named { id: string; title?: string; name?: string; slug?: string }

export interface SubmittableSession {
  id:             string
  title:          string
  scheduledStart: string
  courseId?:      Named
  sectionId?:     Named
  instructorId?:  Named
}

export interface ClassAssignmentReview {
  status:     ClassAssignmentStatus
  reason?:    string
  attempt:    number
  reviewedAt: string
}

export interface MyClassAssignment {
  id:           string
  title:        string
  note?:        string
  files:        AssignmentFile[]
  status:       ClassAssignmentStatus
  attempt:      number
  lastReason?:  string
  submittedAt:  string
  reviewedAt?:  string
  reviews:      ClassAssignmentReview[]
  liveClassId?: Named & { scheduledStart?: string }
  courseId?:    Named
  sectionId?:   Named
  instructorId?: Named
}

export const classAssignmentKeys = {
  all:         ['classAssignments'] as const,
  mine:        ['classAssignments', 'mine'] as const,
  submittable: ['classAssignments', 'submittable'] as const,
}

/* The backend's toJSON already maps _id → id, but populated sub-documents
   come back through the same transform and a few older rows predate it, so
   normalise defensively rather than trusting the shape. */
function withId<T extends Record<string, any>>(o: T | undefined | null): any {
  if (!o) return o
  return { ...o, id: o.id ?? o._id }
}
function normalize(a: any): MyClassAssignment {
  return {
    ...a,
    id:           a.id ?? a._id,
    files:        a.files ?? [],
    reviews:      a.reviews ?? [],
    liveClassId:  withId(a.liveClassId),
    courseId:     withId(a.courseId),
    sectionId:    withId(a.sectionId),
    instructorId: withId(a.instructorId),
  }
}

/* ── The classes this student may submit against ────── */
export function useSubmittableSessions() {
  return useQuery({
    queryKey: classAssignmentKeys.submittable,
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: any[] }>('/class-assignments/submittable')
      return res.data.data.map(withId) as SubmittableSession[]
    },
    staleTime: 60_000,
  })
}

/* ── This student's submissions ─────────────────────── */
export function useMyClassAssignments() {
  return useQuery({
    queryKey: classAssignmentKeys.mine,
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: any[] }>('/class-assignments/me')
      return res.data.data.map(normalize)
    },
    staleTime: 15_000,
  })
}

/* ── Upload one attachment ──────────────────────────────
   Goes through the backend's own /uploads/document route, which magic-byte
   checks the file and stores it on our storage. The submit call then sends
   the returned URL — the API refuses any reference that is not ours. */
export async function uploadAssignmentFile(file: File): Promise<AssignmentFile> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ success: true; data: { url: string; size: number } }>(
    '/uploads/document', form, { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return {
    url:       res.data.data.url,
    name:      file.name,
    mimeType:  file.type,
    sizeBytes: res.data.data.size ?? file.size,
  }
}

/* ── Submit ─────────────────────────────────────────── */
export function useSubmitClassAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      liveClassId: string
      title:       string
      note?:       string
      files:       AssignmentFile[]
    }) => {
      const res = await api.post<{ success: true; data: any }>('/class-assignments', input)
      return normalize(res.data.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: classAssignmentKeys.all }) },
  })
}

/* ── Send a revision after a rejection ──────────────── */
export function useResubmitClassAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; note?: string; files: AssignmentFile[] }) => {
      const res = await api.post<{ success: true; data: any }>(`/class-assignments/${id}/resubmit`, body)
      return normalize(res.data.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: classAssignmentKeys.all }) },
  })
}
