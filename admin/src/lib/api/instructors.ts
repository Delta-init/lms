'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost } from '@/lib/axios'

export interface CourseEnrollmentDto {
  courseId:       string
  blockedLessons: string[]
}

export interface CreateInstructorDto {
  name:        string
  email:       string
  password:    string
  role:        'student' | 'instructor' | 'admin'
  bio?:        string
  headline?:   string
  category?:   '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
  categories?: ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]
  avatarUrl?:  string
  courses?:    CourseEnrollmentDto[]
}

export interface InstructorUser {
  id:        string
  name:      string
  email:     string
  role:      string
  isActive:  boolean
  createdAt: string
}

/**
 * Mutation: admin creates a new instructor (or admin) account.
 * POST /admin/users
 */
export function useCreateInstructor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateInstructorDto) =>
      apiPost<InstructorUser>('/admin/users', dto),
    onSuccess: () => {
      /* Invalidate the instructor list so the table refreshes */
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}
