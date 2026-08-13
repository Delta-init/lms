'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Heart, BookOpen, Star, Users, Clock } from 'lucide-react'
import { useMyFavorites } from '@/lib/api/favorites'
import { FavoriteButton } from '@/components/courses/FavoriteButton'
import type { Course } from '@/types/index'
import Spinner from '@/components/ui/Spinner'

function fmtMins(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60); const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function asCourse(row: { courseId: string | Course }) {
  return typeof row.courseId === 'object' && row.courseId !== null ? row.courseId : null
}

export default function FavoritesPage() {
  const { data, isLoading } = useMyFavorites({ per_page: 30 })
  const docs = data?.docs ?? []

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Heart size={14} fill="#EF4444" style={{ color: 'var(--color-danger)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-danger)' }}>
            Saved
          </span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Favorites
          {data && (
            <span className="ml-2 inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-sm font-bold"
              style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
              {data.meta.total_count}
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Courses you&apos;ve saved for later. Tap the heart on any course page to add it here.
        </p>
      </motion.div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <Spinner size={14} />Loading…
        </div>
      )}

      {!isLoading && docs.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{ background: '#FEE2E2', border: '1px solid rgba(239,68,68,0.22)' }}>
            <Heart size={22} style={{ color: 'var(--color-danger)' }} />
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>No favorites yet</p>
          <p className="text-sm max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
            Find a course you like and tap the heart to save it here.
          </p>
          <Link href="/courses"
            className="mt-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ background: 'var(--color-primary)' }}>
            Browse courses
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {docs.map((row, i) => {
          const course = asCourse(row)
          if (!course) return null
          return (
            <motion.div key={row.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="relative">
              <Link href={`/courses/${course.slug}`}>
                <div className="group overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] transition-all hover:shadow-lg"
                  style={{ border: '1px solid var(--color-border)' }}>
                  <div className="relative h-36 overflow-hidden">
                    {course.thumbnailUrl
                      ? <img src={course.thumbnailUrl} alt={course.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      : <div className="flex h-full w-full items-center justify-center" style={{ background: 'var(--color-bg-page)' }}>
                          <BookOpen size={26} style={{ color: 'var(--color-text-muted)' }} />
                        </div>}
                    <div className="absolute top-2 right-2">
                      <FavoriteButton courseId={course.id} variant="icon" />
                    </div>
                  </div>
                  <div className="p-3.5">
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
        })}
      </div>
    </div>
  )
}
