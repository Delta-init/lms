'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { BookOpen, Users, ChevronRight, Search, GraduationCap } from 'lucide-react'
import { useLearningPaths } from '@/lib/api/learningpaths'
import Spinner from '@/components/ui/Spinner'

export default function LearningPathsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const { data, isLoading } = useLearningPaths({ page })

  const paths = data?.paths ?? []
  const meta  = data?.meta

  const filtered = search
    ? paths.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        (p.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : paths

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Learning Paths
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Curated sequences of courses to guide you from beginner to expert.
        </p>
      </motion.div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search learning paths…"
          className="w-full rounded-xl py-2.5 pl-9 pr-4 text-sm outline-none"
          style={{ background: 'var(--color-bg-page)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
        />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <GraduationCap size={36} style={{ color: 'var(--color-border)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No learning paths found.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((path, i) => {
            const instructor = typeof path.instructorId === 'object' ? path.instructorId : null
            const courseCount = path.courses.length

            return (
              <motion.div key={path.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}>
                <Link href={`/learning-paths/${path.slug}`}>
                  <div className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] transition-shadow hover:shadow-md"
                    style={{ border: '1px solid var(--color-border)' }}>
                    {/* Thumbnail */}
                    <div className="relative h-36 w-full overflow-hidden"
                      style={{ background: 'rgba(0,87,184,0.09)' }}>
                      {path.thumbnailUrl
                        ? <img src={path.thumbnailUrl} alt={path.title} className="h-full w-full object-cover" />
                        : (
                          <div className="flex h-full w-full items-center justify-center">
                            <GraduationCap size={40} style={{ color: 'var(--color-primary)', opacity: 0.5 }} />
                          </div>
                        )}
                      <div className="absolute bottom-2 left-2">
                        <span className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white"
                          style={{ background: 'rgba(13,15,26,0.65)', backdropFilter: 'blur(4px)' }}>
                          {courseCount} {courseCount === 1 ? 'course' : 'courses'}
                        </span>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="text-sm font-bold line-clamp-2" style={{ color: 'var(--color-text-primary)' }}>
                        {path.title}
                      </h3>
                      {path.description && (
                        <p className="mt-1.5 text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                          {path.description}
                        </p>
                      )}

                      <div className="mt-auto pt-3 flex items-center justify-between">
                        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {instructor && (
                            <span className="flex items-center gap-1">
                              <BookOpen size={11} />{instructor.name}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Users size={11} />{path.enrolledCount.toLocaleString()}
                          </span>
                        </div>
                        <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }}
                          className="transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={!meta.has_prev} onClick={() => setPage(p => p - 1)}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-secondary)' }}>
            ← Prev
          </button>
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {meta.page} / {meta.total_pages}
          </span>
          <button disabled={!meta.has_next} onClick={() => setPage(p => p + 1)}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-bg-page)', color: 'var(--color-text-secondary)' }}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
