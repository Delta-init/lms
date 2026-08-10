import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'

export type DocField = 'passport' | 'idDoc'

/**
 * Resolve a stored identity-document value into something the browser can show.
 *
 * Passport and national-ID scans are stored as bare storage KEYS (e.g.
 * `kyc/1712…-ab12.png`) and live in a bucket with no public access, so they
 * have to be exchanged for a short-lived signed link (H-11). Anything that is
 * already an absolute URL — a legacy `documents/` row, or the profile photo,
 * which stays public because it doubles as the avatar — passes straight
 * through untouched.
 *
 * Links expire after five minutes, so the cache is deliberately shorter.
 */
export function useDocumentUrl(
  userId: string | undefined,
  field:  DocField,
  stored?: string,
): string | undefined {
  const needsSigning = !!stored && !/^https?:\/\//i.test(stored)

  const { data } = useQuery({
    queryKey:  ['admin', 'document', userId, field],
    queryFn:   () => apiGet<{ url: string; expiresIn: number | null }>(`/documents/${userId}/${field}`),
    enabled:   !!userId && needsSigning,
    staleTime: 4 * 60 * 1000,
    gcTime:    4 * 60 * 1000,
    retry:     false,
  })

  return needsSigning ? data?.url : stored
}
