/* ─────────────────────────────────────────────────────
   Integration signing keys  (LMS ↔ CLT Connect)
   ─────────────────────────────────────────────────────
   ASYMMETRIC on purpose, and deliberately not the HS256 pattern both apps use
   for their own sessions. A shared secret across a trust boundary lets EITHER
   side mint the other's identities, so a compromise of the meeting platform
   would let an attacker forge LMS instructors. With Ed25519 the LMS holds the
   private key and CLT only ever holds the public half: it can verify, never
   issue.

   ROTATION is why the public key is served as a JWKS rather than a single PEM.
   Publish the new key alongside the old, wait for CLT's cache TTL to lapse,
   then drop the old one — no coordinated deploy, no downtime. `kid` in the
   token header tells the verifier which key to use, so both are valid at once
   during the overlap.

   The whole integration is OPTIONAL: with no key configured these helpers
   report unconfigured and the LMS behaves exactly as before. That keeps the
   feature safe to merge long before it is switched on.
───────────────────────────────────────────────────── */
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { logger } from '@/utils/logger.ts'

export const TICKET_ALG    = 'EdDSA'
export const TICKET_ISSUER = process.env['INTEGRATION_JWT_ISSUER'] ?? 'lms.deltainstitutions'
export const TICKET_AUD    = process.env['INTEGRATION_JWT_AUDIENCE'] ?? 'clt-connect'

export interface SigningKey {
  kid:     string
  private: KeyObject
  jwk:     Record<string, unknown>   // public half, JWKS-shaped
}

interface KeyState {
  active:   SigningKey | null        // signs new tickets
  previous: SigningKey | null        // published for verification only
}

let state: KeyState | null = null

/* ─────────────────────────────────────────────────────
   Getting a PEM through a .env file
   ─────────────────────────────────────────────────────
   A PEM is multi-line and .env is a line-based format, which every parser
   solves differently. Bun's expands \n escapes and then ENDS THE VALUE at the
   first newline — quoted or not — so a one-line escaped PEM silently arrives
   as just "-----BEGIN PRIVATE KEY-----" and OpenSSL rejects it with
   BAD_END_LINE. That failure is quiet and easy to misread as a bad key.

   So BASE64 is the supported form: one line, no escapes, nothing for a parser
   to reinterpret, and it survives PM2, systemd and CI secret stores unchanged.
   Raw PEM (real or \n-escaped) is still accepted for anyone who already has
   one working.

     bun -e "console.log(require('fs').readFileSync('key.pem').toString('base64'))"
─────────────────────────────────────────────────────── */
function normalisePem(raw: string): string {
  const value = raw.trim()
  if (value.includes('BEGIN')) {
    const pem = value.includes('\\n') ? value.replace(/\\n/g, '\n') : value
    return pem.endsWith('\n') ? pem : pem + '\n'
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8')
  return decoded.endsWith('\n') ? decoded : decoded + '\n'
}

/* ─────────────────────────────────────────────────────
   Why node:crypto rather than jose's key helpers
   ─────────────────────────────────────────────────────
   Two of jose's helpers cannot do this job here:

     - importPKCS8 resolves to jose's BROWSER build under Bun's ESM
       resolution, whose ASN.1 reader does not know the Ed25519 OID and throws
       "Invalid or unsupported EC Key Curve or OKP Key Sub Type".
     - exportJWK refuses a node KeyObject ("Key must be one of type CryptoKey
       or Uint8Array"), so even a successful import could not be published.

   Signing accepts a node KeyObject directly, so the private half needs no
   conversion. The public half is derived by hand: an Ed25519 SPKI DER is a
   fixed 12-byte prefix followed by the raw 32-byte key, and the JWK is that
   key base64url-encoded. This is stable across jose builds and bundlers,
   which is the point — key loading must not depend on which copy of a library
   the runtime happened to resolve.
─────────────────────────────────────────────────────── */
const ED25519_RAW_KEY_BYTES = 32

function publicJwkFrom(privatePem: string, kid: string): Record<string, unknown> {
  const der = createPublicKey(privatePem).export({ type: 'spki', format: 'der' })
  const raw = der.subarray(der.length - ED25519_RAW_KEY_BYTES)
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x:   raw.toString('base64url'),
    alg: TICKET_ALG,
    use: 'sig',
    kid,
  }
}

async function load(pem: string | undefined, kid: string | undefined, label: string): Promise<SigningKey | null> {
  if (!pem?.trim() || !kid?.trim()) return null
  try {
    const normalised = normalisePem(pem.trim())
    const key = createPrivateKey(normalised)
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error(`expected an ed25519 key, got ${key.asymmetricKeyType ?? 'unknown'}`)
    }
    /* Derived from the private half so .env carries one value rather than two
       that can drift out of step. */
    return { kid: kid.trim(), private: key, jwk: publicJwkFrom(normalised, kid.trim()) }
  } catch (err) {
    logger.error({ err, label }, 'integration signing key could not be loaded — check INTEGRATION_JWT_PRIVATE_KEY')
    return null
  }
}

async function ensureLoaded(): Promise<KeyState> {
  if (state) return state
  const active = await load(
    process.env['INTEGRATION_JWT_PRIVATE_KEY'],
    process.env['INTEGRATION_JWT_KID'],
    'active',
  )
  const previous = await load(
    process.env['INTEGRATION_JWT_PRIVATE_KEY_PREVIOUS'],
    process.env['INTEGRATION_JWT_KID_PREVIOUS'],
    'previous',
  )
  state = { active, previous }

  if (active) {
    logger.info(
      { kid: active.kid, previousKid: previous?.kid ?? null, alg: TICKET_ALG },
      'CLT integration signing key loaded',
    )
  } else {
    logger.info('CLT integration disabled (no INTEGRATION_JWT_PRIVATE_KEY / INTEGRATION_JWT_KID)')
  }
  return state
}

/** The key new tickets are signed with, or null when the integration is off. */
export async function activeSigningKey(): Promise<SigningKey | null> {
  return (await ensureLoaded()).active
}

export async function integrationEnabled(): Promise<boolean> {
  return (await activeSigningKey()) !== null
}

/**
 * Public JWKS. Contains the active key and, during a rotation, the previous
 * one — a ticket signed minutes before the swap must still verify.
 */
export async function publicJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const { active, previous } = await ensureLoaded()
  return { keys: [active?.jwk, previous?.jwk].filter(Boolean) as Record<string, unknown>[] }
}

/** Tests mutate env between cases; production never calls this. */
export function __resetIntegrationKeys(): void {
  state = null
}
