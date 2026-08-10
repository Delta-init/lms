'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, api } from '@/lib/axios'

export const totpKeys = {
  status: ['auth', '2fa', 'status'] as const,
}

export function useTotpStatus() {
  return useQuery({
    queryKey: totpKeys.status,
    queryFn:  () => apiGet<{ enabled: boolean }>('/auth/2fa/status'),
    staleTime: 60_000,
  })
}

/* Setup re-authenticates with the password, the same bar disable() uses.
   The secret it returns decides whether the account has a second factor at
   all, so a live session alone is not enough to ask for one (NEW-01). */
export function useTotpSetup() {
  return useMutation({
    mutationFn: (password: string) =>
      api.post<{ success: true; data: { secret: string; otpauthUrl: string } }>(
        '/auth/2fa/setup', { password },
      ).then(r => r.data.data),
  })
}

export function useTotpEnable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => api.post('/auth/2fa/enable', { code }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: totpKeys.status }),
  })
}

export function useTotpDisable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (password: string) => api.post('/auth/2fa/disable', { password }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: totpKeys.status }),
  })
}
