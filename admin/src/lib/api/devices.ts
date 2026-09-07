'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export type DeviceStatus = 'pending' | 'approved' | 'revoked'

export interface DeviceView {
  id:         string
  userId:     string
  name:       string | null
  email:      string
  phone:      string | null
  status:     DeviceStatus
  isMain:     boolean
  label:      string | null
  ip:         string | null
  createdAt:  string
  approvedAt: string | null
  lastSeenAt: string | null
}

const KEYS = {
  list: (status: string) => ['admin', 'devices', status] as const,
}

/** All student devices (pending first), or one status. */
export function useDevices(status: DeviceStatus | 'all' = 'all') {
  return useQuery({
    queryKey: KEYS.list(status),
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (status !== 'all') params['status'] = status
      const res = await api.get<{ success: true; data: DeviceView[] }>('/admin/devices', { params })
      return res.data.data
    },
    staleTime: 20_000,
  })
}

export function useApproveDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/admin/devices/${id}/approve`, {})
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
  })
}

export function useRevokeDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/admin/devices/${id}/revoke`, {})
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
  })
}
