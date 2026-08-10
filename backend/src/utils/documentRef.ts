import { z } from 'zod'
import { env } from '@/config/env.ts'

/* ─────────────────────────────────────────────────────
   Identity-document references  (P-07 / P-19)
   ─────────────────────────────────────────────────────
   Two shapes are legitimate for a stored document value, and the schemas that
   persist one used to accept only the first:

     1. An absolute URL on OUR OWN storage — legacy rows written before H-11,
        and the profile photo, which stays public because it doubles as the
        avatar and is rendered in ~47 places.

     2. A bare storage key under `kyc/` — what POST /uploads/kyc has returned
        since H-11. An identity scan must not have an addressable URL at all;
        that was the whole point of the finding. The key is exchanged for a
        five-minute signed link by GET /documents/:userId/:field.

   Validating with `z.string().url()` rejected shape 2 outright, so after the
   H-11 fix landed *no passport or ID could be saved by anyone* — the upload
   succeeded and the save that followed answered 422. In the registration flow
   that 422 arrives after the account already exists, stranding the user.

   Anything outside those two shapes is refused. An arbitrary URL here is not
   inert: the admin panel renders it while staff review an enrolment, so a
   student could point it at a host they control and learn who reviewed their
   file, or serve one document to a reviewer and another to an auditor (P-19).
───────────────────────────────────────────────────── */

/** `kyc/<name>` — the key shape makeKey() produces. No traversal, no nesting. */
const KYC_KEY = /^kyc\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Hosts we serve uploads from. Built once — env is fixed at boot. */
const OWN_HOSTS: ReadonlySet<string> = new Set(
  [env.R2_PUBLIC_URL, env.BACKEND_PUBLIC_URL]
    .filter((v): v is string => !!v)
    .flatMap(base => {
      try { return [new URL(base).host] } catch { return [] }
    }),
)

function isOwnStorageUrl(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  return OWN_HOSTS.has(url.host)
}

/** True for an empty string, a kyc/ key, or a URL on our own storage. */
export function isValidDocumentRef(value: string): boolean {
  if (value === '') return true
  if (KYC_KEY.test(value)) return true
  return isOwnStorageUrl(value)
}

const MESSAGE =
  'Must be an upload key from /uploads/kyc or a URL on this platform\'s own storage'

/** Optional document reference — use for fields that may be left unset. */
export const documentRef = z
  .string()
  .refine(isValidDocumentRef, MESSAGE)
  .optional()

/** Required document reference — rejects the empty string as well. */
export const requiredDocumentRef = z
  .string()
  .min(1, 'This document is required')
  .refine(isValidDocumentRef, MESSAGE)
