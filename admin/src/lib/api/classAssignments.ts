'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* ─────────────────────────────────────────────────────
   Post-class assignments — the reviewer's side.

   Prefix is /class-assignments. The older /assignments routes belong to the
   lesson-level assignment feature and are unrelated.

   Query keys are namespaced under 'admin' per the repo convention, so this
   cache can never collide with the student app's ['classAssignments', …].
───────────────────────────────────────────────────── */

export type ClassAssignmentStatus = 'pending' | 'approved' | 'rejected'

export interface AssignmentFile {
  url:       string
  name:      string
  mimeType:  string
  sizeBytes: number
}

export interface AssignmentReview {
  status:     ClassAssignmentStatus
  reason?:    string
  attempt:    number
  reviewedAt: string
}

interface Ref { id: string; title?: string; name?: string; email?: string; avatarUrl?: string; scheduledStart?: string }

export interface ReviewAssignment {
  id:           string
  title:        string
  note?:        string
  files:        AssignmentFile[]
  status:       ClassAssignmentStatus
  attempt:      number
  lastReason?:  string
  submittedAt:  string
  reviewedAt?:  string
  reviews:      AssignmentReview[]
  studentId?:   Ref
  liveClassId?: Ref
  courseId?:    Ref
  sectionId?:   Ref
}

export const classAssignmentKeys = {
  all:    ['admin', 'classAssignments'] as const,
  queue:  (status: string) => ['admin', 'classAssignments', 'queue', status] as const,
}

function withId(o: any) { return o ? { ...o, id: o.id ?? o._id } : o }
function normalize(a: any): ReviewAssignment {
  return {
    ...a,
    id:          a.id ?? a._id,
    files:       a.files ?? [],
    reviews:     a.reviews ?? [],
    studentId:   withId(a.studentId),
    liveClassId: withId(a.liveClassId),
    courseId:    withId(a.courseId),
    sectionId:   withId(a.sectionId),
  }
}

/* ── The review queue ────────────────────────────────
   Instructors get only their own sessions and staff only their own academy;
   that scoping is the API's job, not a query param this screen can widen. */
export function useReviewQueue(status: 'all' | ClassAssignmentStatus = 'pending') {
  return useQuery({
    queryKey: classAssignmentKeys.queue(status),
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: any[] }>('/class-assignments/review', {
        params: status === 'all' ? {} : { status },
      })
      return res.data.data.map(normalize)
    },
    staleTime: 15_000,
  })
}

/* ── Approve / send back ─────────────────────────────── */
export function useReviewAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, decision, reason }: {
      id:       string
      decision: 'approved' | 'rejected'
      reason?:  string
    }) => {
      const res = await api.patch<{ success: true; data: any }>(
        `/class-assignments/${id}/review`, { decision, reason },
      )
      return normalize(res.data.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: classAssignmentKeys.all }) },
  })
}
