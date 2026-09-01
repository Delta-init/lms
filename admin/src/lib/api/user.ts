'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet, api } from '@/lib/axios'

export interface CurrentAdmin {
  id:              string
  name:            string
  email:           string
  avatarUrl?:      string
  role:            'student' | 'instructor' | 'admin' | 'sub_admin' | 'support' | 'super_admin'
  organizationId?: string
  program?:        'ai' | 'digital_marketing' | 'forex' | 'jura'
  headline?:       string
  bio?:            string
  isVerified:      boolean
  isActive:        boolean
  createdAt:       string
  updatedAt:       string
}

export const userKeys = {
  me: ['auth', 'me'] as const,
}

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me,
    queryFn:  async () => {
      const data = await apiGet<{ user: CurrentAdmin }>('/admin/auth/me')
      return data.user
    },
    retry: false,
    staleTime: 60_000,
  })
}

export function logout(): Promise<void> {
  return api.post('/admin/auth/logout').then(() => {/* no-op */}).catch(() => {/* best-effort */})
}
