import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'

export type DocField = 'passport' | 'idDoc'

/** What the reviewer is actually looking at. */
export type DocState =
  /** No document was ever submitted for this field. */
  | 'absent'
  /** One was submitted; its link is still being fetched. */
  | 'loading'
  /** One was submitted; the link could not be fetched. */
  | 'error'
  /** Ready to display. */
  | 'ready'

export interface ResolvedDocument {
  url?:    string
  state:   DocState
  /** Re-request the signed link after a failure. */
  retry?:  () => void
}

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
 * This used to return `string | undefined`, which collapsed three different
 * situations into one: no document, a link still loading, and a link that
 * failed. The card downstream renders `!url` as "Not submitted — click to
 * upload", so a student's passport that merely failed to resolve was reported
 * to the reviewer as never submitted — and the card then invited them to
 * upload a replacement over it. `GET /documents/:userId/:field` answers 404
 * for several distinct reasons (no stored value, an unreadable key, a
 * cross-academy read, a deleted caller), so a failure here is not rare enough
 * to guess at.
 *
 * Links expire after five minutes, so the cache is deliberately shorter.
 */
export function useDocumentUrl(
  userId: string | undefined,
  field:  DocField,
  stored?: string,
): ResolvedDocument {
  const needsSigning = !!stored && !/^https?:\/\//i.test(stored)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey:  ['admin', 'document', userId, field],
    queryFn:   () => apiGet<{ url: string; expiresIn: number | null }>(`/documents/${userId}/${field}`),
    enabled:   !!userId && needsSigning,
    staleTime: 4 * 60 * 1000,
    gcTime:    4 * 60 * 1000,
    /* One retry: a signed link is fetched once per review and a single blip
       would otherwise stick for the whole cache window, reading as a missing
       document. Not more — a genuine 404 should surface promptly. */
    retry:     1,
  })

  /* Nothing stored is the only case that genuinely means "not submitted". */
  if (!stored) return { state: 'absent' }

  /* Already a URL — nothing to fetch. */
  if (!needsSigning) return { url: stored, state: 'ready' }

  if (isError)          return { state: 'error', retry: () => { void refetch() } }
  if (isPending)        return { state: 'loading' }
  if (data?.url)        return { url: data.url, state: 'ready' }

  /* Resolved without a URL — treat as a failure, never as absence. */
  return { state: 'error', retry: () => { void refetch() } }
}
