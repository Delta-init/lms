/* ─────────────────────────────────────────────────────────────
   2FA end-to-end suite — runs against an ISOLATED throwaway database
   (lms_2fa_suite) on the same local mongod, dropped on exit. The real
   `lms` database is never opened.

   Exercises the whole second-factor lifecycle through the real services
   and a real DB: the NEW-01 password gate, enable, the login challenge,
   TOTP correctness against an INDEPENDENT RFC-6238 implementation,
   challenge hardening, disable, and admin reset.
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_2fa_suite'
process.env.NODE_ENV     = 'test'

import { createHmac } from 'node:crypto'

/* ── Independent RFC 6238 implementation ──────────────────────
   Deliberately NOT the service's own code — if both were the same
   implementation the window tests would only prove self-consistency. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32decode(s: string): Buffer {
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(ch)
    if (i === -1) continue
    value = (value << 5) | i; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(out)
}
function codeAt(secret: string, stepOffset = 0, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30) + stepOffset
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  msg.writeUInt32BE(counter >>> 0, 4)
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest()
  const o = h[19]! & 0x0f
  const n = ((h[o]! & 0x7f) << 24 | (h[o + 1]! & 0xff) << 16 | (h[o + 2]! & 0xff) << 8 | (h[o + 3]! & 0xff)) % 1_000_000
  return String(n).padStart(6, '0')
}

/* ── Step-boundary stabiliser ─────────────────────────────────
   Generating a code and verifying it happen at two different moments. TOTP
   steps are 30s wide, so if a boundary falls between them every ±1/±2
   expectation shifts by one and the window assertions invert — a rare but
   real flake that would look like a product bug. Park at the start of a
   fresh step so the whole phase runs inside one. */
async function awaitStableStep(marginSec = 6): Promise<void> {
  const secondsIntoStep = (Date.now() / 1000) % 30
  const untilBoundary   = 30 - secondsIntoStep
  if (untilBoundary < marginSec) {
    await new Promise(r => setTimeout(r, (untilBoundary + 0.25) * 1000))
  }
}

/* ── Tiny assertion harness ───────────────────────────────── */
let pass = 0, fail = 0
const results: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; results.push(`  PASS  ${label}`) }
  else    { fail++; results.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
/** Run fn and report the error CODE it threw (or 'ok' if it didn't). */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'ok' }
  catch (e: any) { return e?.code ?? `UNEXPECTED:${e?.message}` }
}
async function expectCode(label: string, fn: () => Promise<unknown>, want: string) {
  const got = await codeOf(fn)
  check(label, got === want, `got ${got}, want ${want}`)
}

const mongoose  = (await import('mongoose')).default

/* autoIndex off: mongoose builds indexes asynchronously and those builds race
   the dropDatabase() in the finally below, recreating empty collection shells
   after teardown and leaving a stray database behind. */
mongoose.set('autoIndex', false)
const { UserModel } = await import('@/models/schema.ts')
const { TotpService } = await import('@/services/totp.service.ts')
const { AuthService } = await import('@/services/auth.service.ts')
const { hashPassword } = await import('@/utils/hash.ts')

const totp = new TotpService()
const auth = new AuthService()

const EMAIL = `2fa-suite-${Date.now()}@test.local`
const PW    = 'CorrectHorse1'
const WRONG = 'WrongHorse9'

/* A wrong 2FA code feeds the SAME durable lockout counter a wrong password
   does — deliberate, so guessing survives neither a fresh challenge nor a
   process restart. This suite fires many wrong codes on purpose, so it trips
   that lock. Phase L asserts the lock genuinely engages; every other phase
   clears the counter first so it is testing what it claims to test. */
async function unlock(uid: string) {
  await UserModel.findByIdAndUpdate(uid, {
    $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 },
  }).exec()
}

await mongoose.connect(process.env.DATABASE_URL!)
const dbName = mongoose.connection.db!.databaseName
if (dbName !== 'lms_2fa_suite') {
  console.error(`REFUSING TO RUN — connected to "${dbName}", expected the throwaway db`)
  process.exit(1)
}

try {
  const user = await UserModel.create({
    name: '2FA Suite', email: EMAIL, passwordHash: await hashPassword(PW),
    role: 'student', isActive: true,
  })
  const uid = String(user._id)

  /* ── A. The NEW-01 gate: can a session alone start setup? ── */
  await expectCode('A1  setup with empty password refused',   () => totp.setup(uid, ''),      'WRONG_PASSWORD')
  await expectCode('A2  setup with wrong password refused',   () => totp.setup(uid, WRONG),   'WRONG_PASSWORD')

  const { secret, otpauthUrl } = await totp.setup(uid, PW)
  check('A3  setup with correct password succeeds', !!secret)
  check('A4  secret is 32-char base32',             /^[A-Z2-7]{32}$/.test(secret), secret)
  check('A5  otpauth URL carries the secret',       otpauthUrl.includes(`secret=${secret}`))
  check('A6  secret is NOT yet active',             (await totp.status(uid)).enabled === false)

  /* ── B. Enable ── */
  await expectCode('B1  enable with a wrong code refused', () => totp.enable(uid, '000000'), 'INVALID_CODE')
  await totp.enable(uid, codeAt(secret))
  check('B2  enable with a valid code activates 2FA', (await totp.status(uid)).enabled === true)
  await expectCode('B3  setup refused once enabled',  () => totp.setup(uid, PW), 'ALREADY_ENABLED')

  /* ── C. Login through the second factor ── */
  const step1: any = await auth.login({ email: EMAIL, password: PW })
  check('C1  password step yields a challenge, not a session', step1.twoFactorRequired === true && !!step1.challengeToken)
  check('C2  no tokens leak from the password step',           step1.tokens === undefined)

  await expectCode('C3  wrong code at step 2 refused',
    () => auth.loginTwoFactor(step1.challengeToken, '000000'), 'INVALID_2FA_CODE')

  const done: any = await auth.loginTwoFactor(step1.challengeToken, codeAt(secret))
  check('C4  correct code issues a real session', !!done.tokens?.access_token && !!done.tokens?.refresh_token)
  check('C5  session belongs to the right account', done.user?.email === EMAIL)

  await expectCode('C6  challenge is single-use (replay refused)',
    () => auth.loginTwoFactor(step1.challengeToken, codeAt(secret)), 'INVALID_2FA_CHALLENGE')

  await expectCode('C7  wrong password never reaches step 2',
    () => auth.login({ email: EMAIL, password: WRONG }), 'INVALID_CREDENTIALS')

  /* ── D. TOTP correctness vs an independent implementation ── */
  const fresh = async () => {
    await unlock(uid)   /* wrong codes below feed the lockout — see phase L */
    return (await auth.login({ email: EMAIL, password: PW }) as any).challengeToken
  }
  await awaitStableStep()
  for (const [offset, shouldWork, why] of [
    [ 0, true,  'current step accepted'],
    [-1, true,  'previous step accepted (clock skew)'],
    [ 1, true,  'next step accepted (clock skew)'],
    [-2, false, 'two steps back REFUSED'],
    [ 2, false, 'two steps forward REFUSED'],
  ] as [number, boolean, string][]) {
    const token = await fresh()
    const got   = await codeOf(() => auth.loginTwoFactor(token, codeAt(secret, offset)))
    check(`D   ${why}`, shouldWork ? got === 'ok' : got === 'INVALID_2FA_CODE', `got ${got}`)
  }
  check('D6  codes are 6 numeric digits', /^\d{6}$/.test(codeAt(secret)))

  /* ── E. Challenge hardening ── */
  await expectCode('E1  garbage challenge token refused',
    () => auth.loginTwoFactor('not-a-token', codeAt(secret)), 'INVALID_2FA_CHALLENGE')
  await expectCode('E2  an access token is not a challenge',
    () => auth.loginTwoFactor(done.tokens.access_token, codeAt(secret)), 'INVALID_2FA_CHALLENGE')

  const capped = await fresh()
  for (let i = 0; i < 5; i++) {
    await unlock(uid)   /* isolate the PER-CHALLENGE cap from the account lock */
    await codeOf(() => auth.loginTwoFactor(capped, String(i).repeat(6)))
  }
  await unlock(uid)
  await expectCode('E3  per-challenge cap fires after 5 wrong codes',
    () => auth.loginTwoFactor(capped, codeAt(secret)), 'TOO_MANY_2FA_ATTEMPTS')

  /* ── L. Wrong codes must feed the durable account lockout ──
     The property that makes code-guessing pointless: the counter is on the
     ACCOUNT, so a fresh challenge (or a process restart) does not reset it. */
  await unlock(uid)
  const lockTok = await fresh()
  let lockedAt = -1
  for (let i = 1; i <= 8; i++) {
    const got = await codeOf(() => auth.loginTwoFactor(lockTok, String(i % 10).repeat(6)))
    if (got === 'ACCOUNT_LOCKED') { lockedAt = i; break }
  }
  check('L1  repeated wrong codes lock the account', lockedAt > 0, `never locked in 8 tries`)
  const lockedDoc = await UserModel.findById(uid).lean() as any
  check('L2  lockout is persisted on the account', !!lockedDoc?.lockedUntil)
  await expectCode('L3  even the CORRECT password is refused while locked',
    () => auth.login({ email: EMAIL, password: PW }), 'ACCOUNT_LOCKED')

  /* ── F. Disable ── */
  await unlock(uid)
  await expectCode('F1  disable with wrong password refused', () => totp.disable(uid, WRONG), 'WRONG_PASSWORD')
  await totp.disable(uid, PW)
  check('F2  disable clears the flag', (await totp.status(uid)).enabled === false)
  const rawAfter = await UserModel.findById(uid).select('+twoFactorSecret').lean() as any
  check('F3  disable also wipes the secret', rawAfter?.twoFactorSecret === undefined)

  const plain: any = await auth.login({ email: EMAIL, password: PW })
  check('F4  login is single-step again', !!plain.tokens?.access_token && !plain.twoFactorRequired)

  /* ── G. Admin reset (the lost-device route) ── */
  const { secret: s2 } = await totp.setup(uid, PW)
  await totp.enable(uid, codeAt(s2))
  check('G1  2FA re-enabled for the reset test', (await totp.status(uid)).enabled === true)
  await totp.adminReset(uid)
  check('G2  admin reset clears the flag', (await totp.status(uid)).enabled === false)
  const rawG = await UserModel.findById(uid).select('+twoFactorSecret').lean() as any
  check('G3  admin reset wipes the secret', rawG?.twoFactorSecret === undefined)
  await expectCode('G4  second reset is a no-op', () => totp.adminReset(uid), 'NOT_ENABLED')
  const after: any = await auth.login({ email: EMAIL, password: PW })
  check('G5  user can sign in with password alone again', !!after.tokens?.access_token)

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
