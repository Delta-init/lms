'use client'
import { useQuery } from '@tanstack/react-query'
import { api, apiGet } from '@/lib/axios'
import type { Course, PaginationMeta } from '@/types/index'

/* ─── Outline returned by GET /courses/:slug ─────── */
export interface Section {
  id:    string
  title: string
  order: number
}

export interface LessonOutline {
  id:           string
  sectionId:    string
  courseId:     string
  title:        string
  type:         'video' | 'article' | 'quiz'
  durationMins: number
  order:        number
  isFree:       boolean
  contentUrl?:  string   // article/external content only — video URLs are NOT sent here
  hasVideo?:    boolean  // true for video lessons; fetch the signed URL via useLessonPlayUrl
  contentBody?: string   // rich text body for article lessons
}

export interface CourseDetail {
  course:   Course
  sections: Section[]
  lessons:  LessonOutline[]
}

/* ─── Query keys ─────────────────────────────────── */
export const courseKeys = {
  all:      ['courses'] as const,
  list:     (p: object) => ['courses', 'list', p] as const,
  detail:   (slug: string) => ['courses', 'detail', slug] as const,
  featured: ['courses', 'featured'] as const,
}

type CoursesParams = {
  page?: number; per_page?: number; search?: string
  /** 'prefix' enables $regex partial-match (supports "pyth" → Python).
   *  Omit or set 'text' for full Mongo $text search (relevance-ranked). */
  search_mode?: 'text' | 'prefix'
  level?: string; category?: string; sort?: string; free?: boolean
  instructor?: string
  duration_min?: number
  duration_max?: number
  price_min?: number
  price_max?: number
  program?: string
}

/* Strip null / undefined / empty-string / `false` values from query params
   so the backend Zod schema doesn't reject e.g. `level=` for an enum field. */
function clean(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v == null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (typeof v === 'boolean' && !v) continue
    if (typeof v === 'number' && Number.isNaN(v)) continue
    out[k] = v
  }
  return out
}

/* ─── List ───────────────────────────────────────── */
export function useCourses(params: CoursesParams = {}) {
  return useQuery({
    queryKey: courseKeys.list(params),
    queryFn: async () => {
      const res = await api.get<{
        success: true
        data: Course[]
        meta: PaginationMeta
      }>('/courses', { params: clean(params as Record<string, unknown>) })
      return { docs: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

/* ─── Single by slug ─────────────────────────────── */
export function useCourse(slug: string) {
  return useQuery({
    queryKey: courseKeys.detail(slug),
    queryFn: () => apiGet<CourseDetail>(`/courses/${slug}`),
    enabled: !!slug,
    retry: false,
  })
}

/* ─── Signed video playback URL ──────────────────
   Video URLs are no longer embedded in the course outline. The player asks
   for a short-lived signed URL here, just before playback. Backend enforces
   enrollment + module access; a permanent public link is never exposed. */
export interface LessonPlayUrl {
  url:       string
  expiresIn: number
}

export function useLessonPlayUrl(lessonId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['lesson-play-url', lessonId ?? ''],
    queryFn:  () => apiGet<LessonPlayUrl>(`/lessons/${lessonId}/play-url`),
    enabled:  !!lessonId && enabled,
    /* URL is valid for hours server-side; cache well under that so a long
       viewing session keeps a fresh link. */
    staleTime: 60 * 60 * 1000,
    retry: false,
  })
}

/* ─── Rating histogram ──────────────────────────── */
export interface RatingHistogram {
  histogram: Record<'1'|'2'|'3'|'4'|'5', number>
  total:     number
  avg:       number
}

export function useRatingHistogram(slug: string | undefined) {
  return useQuery({
    queryKey: ['courses', 'rating-histogram', slug ?? ''],
    queryFn:  () => apiGet<RatingHistogram>(`/courses/${slug}/rating-histogram`),
    enabled:  !!slug,
    staleTime: 60_000,
  })
}

/* ─── Featured (top 4 by enrollment) ────────────── */
export function useFeaturedCourses() {
  return useQuery({
    queryKey: courseKeys.featured,
    queryFn: async () => {
      const res = await api.get<{ success: true; data: Course[] }>('/courses', {
        params: { sort: 'popular', per_page: 4 },
      })
      return res.data.data
    },
    staleTime: 60_000,
  })
}
