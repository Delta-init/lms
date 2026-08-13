'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, BookOpen, Star, Users, Clock } from 'lucide-react'
import { useCourses } from '@/lib/api/courses'
import type { Course } from '@/types/index'
import Spinner from '@/components/ui/Spinner'

function fmtMins(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60); const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/* ─── Result card ─────────────────────────────────────── */
function ResultCard({ course, index }: { course: Course; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}>
      <Link href={`/courses/${course.slug}`}>
        <div className="group overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] transition-all hover:shadow-lg"
          style={{ border: '1px solid var(--color-border)' }}>
          <div className="relative h-32 overflow-hidden">
            {course.thumbnailUrl
              ? <img src={course.thumbnailUrl} alt={course.title}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              : <div className="flex h-full w-full items-center justify-center" style={{ background: 'var(--color-bg-page)' }}>
                  <BookOpen size={26} style={{ color: 'var(--color-text-muted)' }} />
                </div>}
          </div>
          <div className="p-3">
            <p className="line-clamp-2 text-sm font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{course.title}</p>
            {course.instructor && (
              <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{course.instructor.name}</p>
            )}
            <div className="mt-2 flex items-center gap-2.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              {course.ratingAvg > 0 && (
                <span className="flex items-center gap-1" style={{ color: 'var(--color-warning)' }}>
                  <Star size={10} fill="#F59E0B" />{course.ratingAvg.toFixed(1)}
                </span>
              )}
              <span className="flex items-center gap-1"><Users size={10} />{course.enrolledCount.toLocaleString()}</span>
              {course.durationMins > 0 && (
                <span className="flex items-center gap-1"><Clock size={10} />{fmtMins(course.durationMins)}</span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

/* ─── Inner (needs searchParams hook inside Suspense) ─── */
function SearchInner() {
  const params = useSearchParams()
  const q = (params.get('q') ?? '').trim()

  const { data, isLoading } = useCourses({
    search:      q || undefined,
    search_mode: 'prefix',
    per_page:    24,
  })

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header — no redundant search input here (use the navbar search bar above) */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          {q ? `Results for "${q}"` : 'Search'}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {q
            ? 'Type a new query in the search bar above to refine your results.'
            : 'Start typing in the search bar above to find courses.'}
        </p>
      </motion.div>

      <AnimatePresence mode="wait">
        {!q ? (
          <motion.div key="empty"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
              style={{ background: 'var(--color-primary-light)', border: '1px solid rgba(0,87,184,0.18)' }}>
              <Search size={22} style={{ color: 'var(--color-primary)' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Use the search bar at the top to find courses.
            </p>
          </motion.div>
        ) : isLoading ? (
          <motion.div key="loading"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <Spinner size={16} />Searching…
          </motion.div>
        ) : data?.docs.length === 0 ? (
          <motion.div key="none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>No matches for &quot;{q}&quot;</p>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Try a broader keyword or check the spelling.</p>
          </motion.div>
        ) : (
          <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {data?.meta.total_count.toLocaleString()}{' '}
              {data?.meta.total_count === 1 ? 'result' : 'results'}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data?.docs.map((c, i) => <ResultCard key={c.id} course={c} index={i} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-16">
        <Spinner size={18} />
      </div>
    }>
      <SearchInner />
    </Suspense>
  )
}
