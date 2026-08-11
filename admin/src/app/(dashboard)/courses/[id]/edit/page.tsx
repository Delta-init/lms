'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArrowLeft, Edit2, AlertCircle, Radio, Users } from 'lucide-react'
import { use } from 'react'
import { useCourse } from '@/lib/api/courses'
import { CourseForm } from '@/components/courses/CourseForm'
import { LiveClassesSection } from '@/components/courses/LiveClassesSection'
import { useLiveClassesForCourse } from '@/lib/api/liveClasses'
import Spinner from '@/components/ui/Spinner'

/* ── Live alert banner ───────────────────────────────── */
function LiveAlertBanner({ courseId }: { courseId: string }) {
  const { data: classes } = useLiveClassesForCourse(courseId)
  const liveSession = classes?.find(c => c.status === 'live')
  if (!liveSession) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.28)' }}>
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold text-white"
          style={{ background: '#EF4444' }}>
          <span className="h-1.5 w-1.5 rounded-full bg-white" />LIVE
        </motion.div>
        <div>
          <p className="text-sm font-semibold text-white">{liveSession.title}</p>
          {liveSession.viewerCount > 0 && (
            <p className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <Users size={10} />{liveSession.viewerCount.toLocaleString()} watching
            </p>
          )}
        </div>
      </div>
      <Link
        href={`/live-classes/${liveSession.id}/monitor`}
        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all hover:brightness-110"
        style={{ background: '#EF4444' }}>
        <Radio size={11} />Open Monitor →
      </Link>
    </motion.div>
  )
}

export default function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: course, isLoading, isError, error } = useCourse(id)

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={28} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading course…</p>
        </div>
      </div>
    )
  }

  if (isError || !course) {
    const errCode    = (error as any)?.response?.data?.error?.code
    const isForbidden = errCode === 'FORBIDDEN' || errCode === 'MISSING_TOKEN' || errCode === 'UNAUTHORIZED'
    const errMsg     = isForbidden
      ? 'You don\'t have permission to edit this course. Please log in as an admin.'
      : 'Course not found'
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(239,68,68,0.12)' }}>
            <AlertCircle size={22} style={{ color: '#EF4444' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>{errMsg}</p>
          {isForbidden && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Ask a super admin to grant you access to this course.
            </p>
          )}
          <Link href="/courses" className="text-sm font-semibold" style={{ color: '#0057b8' }}>
            Back to courses
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Live class alert banner */}
      <LiveAlertBanner courseId={course.id} />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="mb-7">
        <Link href="/courses" className="mb-4 inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <ArrowLeft size={13} />Back to courses
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(0,87,184,0.15)', border: '1px solid rgba(0,87,184,0.25)' }}>
            <Edit2 size={17} style={{ color: '#0057b8' }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Edit course
            </h1>
            <p className="mt-0.5 max-w-md truncate text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {course.title}
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, type: 'spring', stiffness: 260, damping: 26 }}>
        <CourseForm course={course} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, type: 'spring', stiffness: 260, damping: 26 }}>
        <LiveClassesSection courseId={course.id} />
      </motion.div>
    </div>
  )
}
