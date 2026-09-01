/* ─────────────────────────────────────────────────────────────
   LMS ↔ CLT Connect — Phase 1: the identity foundation.

   The whole integration rests on one claim: only the LMS can mint a ticket,
   and CLT can verify it without ever holding anything that could forge one.
   So this suite verifies tickets exactly the way CLT will — against the
   PUBLISHED JWKS, never against the private key — and then tries to break it:
   tampering, expiry, wrong audience, wrong issuer, a foreign signer, and a
   key rotation mid-flight.

   No database and no HTTP server: this layer is pure crypto.

   Run: bun run test:integration
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'

/* Deterministic keys, set BEFORE the modules load — the key loader caches. */
import { generateKeyPairSync } from 'node:crypto'

function freshKeyB64(): string {
  const { privateKey } = generateKeyPairSync('ed25519')
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64')
}

const KEY_A = freshKeyB64()
const KEY_B = freshKeyB64()

process.env.INTEGRATION_JWT_PRIVATE_KEY = KEY_A
process.env.INTEGRATION_JWT_KID         = 'test-key-a'
process.env.INTEGRATION_JWT_ISSUER      = 'lms.deltainstitutions'
process.env.INTEGRATION_JWT_AUDIENCE    = 'clt-connect'
process.env.INTEGRATION_TICKET_TTL_SEC  = '90'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const { jwtVerify, importJWK, SignJWT } = await import('jose')
const keys   = await import('@/utils/integrationKeys.ts')
const ticket = await import('@/services/integrationTicket.service.ts')

const CLAIMS = {
  userId:      '665f1a2b3c4d5e6f7a8b9c0d',
  name:        'Aisha Rahman',
  email:       'aisha@example.com',
  role:        'student' as const,
  liveClassId: '665f000000000000000000aa',
  roomName:    ticket.roomNameFor('665f000000000000000000aa'),
  orgSlug:     'dubai',
  grants:      { canPublish: true, roomAdmin: false, bypassLobby: true },
}

/** Verify the way CLT will: fetch the JWKS, pick by `kid`, check iss/aud/exp. */
async function verifyAsClt(
  jwt: string,
  opts: { issuer?: string; audience?: string } = {},
) {
  const { keys: published } = await keys.publicJwks()
  const header = JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString())
  const jwk = published.find(k => (k as { kid?: string }).kid === header.kid)
  if (!jwk) throw new Error(`no published key for kid=${header.kid}`)
  const key = await importJWK(jwk as never, 'EdDSA')
  return jwtVerify(jwt, key, {
    issuer:     opts.issuer   ?? 'lms.deltainstitutions',
    audience:   opts.audience ?? 'clt-connect',
    algorithms: ['EdDSA'],
  })
}

try {
  section('A · the published JWKS')
  const jwks = await keys.publicJwks()
  check('exactly one key is published', jwks.keys.length === 1, String(jwks.keys.length))
  const k0 = jwks.keys[0] as Record<string, string>
  check('it is an Ed25519 OKP key', k0['kty'] === 'OKP' && k0['crv'] === 'Ed25519', JSON.stringify(k0))
  check('it carries alg, use and kid so a verifier can select it',
    k0['alg'] === 'EdDSA' && k0['use'] === 'sig' && k0['kid'] === 'test-key-a')
  check('NO private material is published',
    !('d' in k0), 'a JWKS leaking d would hand CLT the ability to mint tickets')
  check('integrationEnabled() reports configured', await keys.integrationEnabled() === true)

  section('B · a minted ticket verifies against the JWKS')
  const minted = await ticket.mintTicket(CLAIMS)
  check('mint returns a ticket, ttl, room and jti',
    !!minted.ticket && minted.expiresIn === 90 && !!minted.jti && !!minted.roomName)

  const { payload, protectedHeader } = await verifyAsClt(minted.ticket)
  check('the header names the algorithm and key', protectedHeader.alg === 'EdDSA' && protectedHeader.kid === 'test-key-a')
  check('sub is the LMS user id — the correlation key', payload.sub === CLAIMS.userId, String(payload.sub))
  check('identity travels in the ticket', payload['name'] === CLAIMS.name && payload['email'] === CLAIMS.email)
  check('role travels in the ticket', payload['role'] === 'student')
  check('the class and room are bound in', payload['liveClassId'] === CLAIMS.liveClassId && payload['roomName'] === CLAIMS.roomName)
  check('grants are decided by the LMS, not the client',
    JSON.stringify(payload['grants']) === JSON.stringify(CLAIMS.grants))
  check('iss and aud are set', payload.iss === 'lms.deltainstitutions' && payload.aud === 'clt-connect')
  check('the ticket expires in 90 seconds',
    (payload.exp ?? 0) - (payload.iat ?? 0) === 90, String((payload.exp ?? 0) - (payload.iat ?? 0)))

  section('C · the room name is derived, never client-supplied')
  check('roomNameFor is lms-<liveClassId>',
    ticket.roomNameFor('abc123') === 'lms-abc123', ticket.roomNameFor('abc123'))
  check('the same class always yields the same room',
    ticket.roomNameFor(CLAIMS.liveClassId) === ticket.roomNameFor(CLAIMS.liveClassId))

  section('D · jti is unique — it is the replay key')
  const jtis = new Set<string>()
  for (let i = 0; i < 200; i++) jtis.add((await ticket.mintTicket(CLAIMS)).jti)
  check('200 mints produce 200 distinct jtis', jtis.size === 200, String(jtis.size))

  section('E · forgery and tampering are rejected')
  const parts = minted.ticket.split('.')
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}AAAA`
  let rejected = false
  try { await verifyAsClt(tampered) } catch { rejected = true }
  check('a tampered signature is rejected', rejected)

  /* Payload swap: re-encode the body claiming instructor, keep the signature. */
  const body = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
  body.role = 'instructor'
  body.grants = { canPublish: true, roomAdmin: true, bypassLobby: true }
  const swapped = `${parts[0]}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${parts[2]}`
  let swapRejected = false
  try { await verifyAsClt(swapped) } catch { swapRejected = true }
  check('a payload edited to claim instructor + roomAdmin is rejected', swapRejected,
    'this is the escalation the signature exists to stop')

  section('F · a ticket signed by a FOREIGN key is rejected')
  const { createPrivateKey } = await import('node:crypto')
  const foreign = createPrivateKey(Buffer.from(KEY_B, 'base64').toString('utf8'))
  const forged = await new SignJWT({ role: 'instructor', grants: { roomAdmin: true } })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key-a' })   // claims OUR kid
    .setSubject(CLAIMS.userId).setIssuedAt()
    .setIssuer('lms.deltainstitutions').setAudience('clt-connect')
    .setExpirationTime('90s')
    .sign(foreign)
  let forgedRejected = false
  try { await verifyAsClt(forged) } catch { forgedRejected = true }
  check('a foreign signer wearing our kid is rejected', forgedRejected,
    'a CLT compromise must not be able to mint LMS identities')

  section('G · audience and issuer are enforced')
  let audRejected = false
  try { await verifyAsClt(minted.ticket, { audience: 'someone-else' }) } catch { audRejected = true }
  check('a ticket presented to the wrong audience is rejected', audRejected)
  let issRejected = false
  try { await verifyAsClt(minted.ticket, { issuer: 'not-the-lms' }) } catch { issRejected = true }
  check('a ticket from an unexpected issuer is rejected', issRejected)

  section('H · expiry')
  process.env.INTEGRATION_TICKET_TTL_SEC = '1'
  keys.__resetIntegrationKeys()
  const shortLived = await import(`@/services/integrationTicket.service.ts?t=${Date.now()}`)
  const quick = await shortLived.mintTicket(CLAIMS)
  await new Promise(r => setTimeout(r, 1500))
  let expiredRejected = false
  try { await verifyAsClt(quick.ticket) } catch { expiredRejected = true }
  check('an expired ticket is rejected', expiredRejected)
  process.env.INTEGRATION_TICKET_TTL_SEC = '90'

  section('I · rotation — both keys verify during the overlap')
  process.env.INTEGRATION_JWT_PRIVATE_KEY          = KEY_B
  process.env.INTEGRATION_JWT_KID                  = 'test-key-b'
  process.env.INTEGRATION_JWT_PRIVATE_KEY_PREVIOUS = KEY_A
  process.env.INTEGRATION_JWT_KID_PREVIOUS         = 'test-key-a'
  keys.__resetIntegrationKeys()

  const rotated = await keys.publicJwks()
  check('both keys are published during rotation', rotated.keys.length === 2, String(rotated.keys.length))
  check('the new key is present',
    rotated.keys.some(k => (k as { kid?: string }).kid === 'test-key-b'))
  check('a ticket minted BEFORE the rotation still verifies', !!(await verifyAsClt(minted.ticket)).payload,
    'otherwise every in-flight join breaks the moment a key rotates')

  const afterRotation = await (await import(`@/services/integrationTicket.service.ts?r=${Date.now()}`)).mintTicket(CLAIMS)
  const hdr = JSON.parse(Buffer.from(afterRotation.ticket.split('.')[0]!, 'base64url').toString())
  check('new tickets are signed by the NEW key', hdr.kid === 'test-key-b', hdr.kid)
  check('and they verify', !!(await verifyAsClt(afterRotation.ticket)).payload)

  section('J · an unconfigured deployment fails safe')
  process.env.INTEGRATION_JWT_PRIVATE_KEY = ''
  process.env.INTEGRATION_JWT_KID = ''
  process.env.INTEGRATION_JWT_PRIVATE_KEY_PREVIOUS = ''
  process.env.INTEGRATION_JWT_KID_PREVIOUS = ''
  keys.__resetIntegrationKeys()

  check('integrationEnabled() reports NOT configured', await keys.integrationEnabled() === false)
  check('the JWKS is empty rather than absent', (await keys.publicJwks()).keys.length === 0)
  /* The original module instance, deliberately: mintTicket reads the key at
     call time, so __resetIntegrationKeys() is enough. A cache-busted re-import
     would create a SECOND IntegrationDisabledError class and instanceof would
     compare against the wrong one. */
  let disabled = false
  try { await ticket.mintTicket(CLAIMS) }
  catch (e) { disabled = e instanceof ticket.IntegrationDisabledError }
  check('minting throws IntegrationDisabledError, not a signing crash', disabled,
    'callers can surface a clean 503')

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}`)
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
