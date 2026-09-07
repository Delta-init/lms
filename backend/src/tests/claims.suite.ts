/* ─────────────────────────────────────────────────────────────
   M-05 / L-06 / L-09 suite.

   Runs against an ISOLATED throwaway database (lms_claims_suite), dropped on
   exit. The real `lms` database is never opened.

     M-05  registration timing must not distinguish a taken address
     L-06  audience binds a token to the portal that issued it, and the
           staged rollout must not sign existing sessions out
     L-09  a per-user daily AI allowance

   L-06 is the dangerous one: it touches every authentication path, so the
   rollout cases matter more than the happy path. A legacy token — no `aud`,
   no `iss`, which is every token already in circulation — must keep working
   until JWT_ENFORCE_AUDIENCE is set, and must stop the moment it is.

   Run: bun run test:claims
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_claims_suite'
process.env.NODE_ENV     = 'test'
delete process.env.JWT_ENFORCE_AUDIENCE
process.env.AI_DAILY_MESSAGE_LIMIT = '3'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }
async function errOf(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'ok' } catch (e: any) { return e?.code ?? `ERR:${e?.message}` }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { SignJWT } = await import('jose')
const { UserModel } = await import('@/models/schema.ts')
const { AuthService } = await import('@/services/auth.service.ts')
const { AIService } = await import('@/services/ai.service.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const jwtUtil = await import('@/utils/jwt.ts')
const { env } = await import('@/config/env.ts')

const auth = new AuthService()
const ai   = new AIService()

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_claims_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const PW = 'CorrectHorse1'

/* Mint a token exactly as the codebase did BEFORE L-06: no iss, no aud. */
async function legacyAccessToken(sub: string, email: string, role: string): Promise<string> {
  return new SignJWT({ email, role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub).setJti('legacy').setIssuedAt().setExpirationTime('15m')
    .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET))
}

try {
  const hash = await hashPassword(PW)
  const user = await UserModel.create({ name: 'U', email: 'u@t.local', passwordHash: hash, role: 'student', isActive: true })
  const uid  = String(user._id)

  /* ══ M-05 ══════════════════════════════════════════ */
  section('M-05 — registration must not leak which addresses exist')
  {
    /* ── Measuring a timing oracle without a flaky test ──────────────────
       This assertion has been wrong twice, in two different ways, and both
       are worth recording because the second looked like a fix.

       V1 took 5 samples per path, compared the MEANS, and failed if they
       differed by more than 80 ms. At 12 bcrypt rounds a register takes ~1 s
       here with a ±400 ms spread, so the standard error on a 5-sample mean is
       ~90 ms — larger than the threshold it was judged against. It was
       measuring noise, and flaked about one run in three.

       V2 tried to drown the noise by raising bcrypt to 13 rounds at runtime.
       It did not work, and it did not announce that it had not worked:
       hashPassword() reads env.BCRYPT_ROUNDS, which the config parses ONCE at
       import, so assigning process.env afterwards changes nothing. The cost
       stayed at 12 rounds and the check kept comparing two noisy numbers — it
       just happened to pass on a quiet machine and failed 3 of 4 runs inside
       the full suite, where everything is slower and the ratio drifted to 0.75.

       V3 stops comparing two measurements. The property is not "the two paths
       take similar time" — that difference is real and small and forever noisy,
       because the new-email path also writes a user. The property is "the
       TAKEN-email path pays a full bcrypt hash", and that has a floor: one
       hash, measured in this same process. If the hash is skipped the taken
       path returns in single-digit milliseconds, so the measurement collapses
       by two orders of magnitude rather than drifting by a factor of two.
       Nothing here depends on the spread. */
    /* Warm up before measuring, and take a median rather than one sample.
       V3 timed the FIRST hashPassword() call in the process as its yardstick,
       which pays bcrypt's native-binding load and JIT on top of the actual
       work. That reads high — 444 ms against a true ~200 ms — and an inflated
       yardstick drags the ratio DOWN, so the run failed at 0.48x while the
       code was correct. A register cannot cost less than the hash it performs;
       when it appears to, the baseline is what is wrong. Discarding the first
       call removes a known systematic bias, which is the honest fix — moving
       the threshold to accommodate it would not have been. */
    await hashPassword(PW)
    const hashSamples: number[] = []
    for (let i = 0; i < 3; i++) {
      const t = performance.now()
      await hashPassword(PW)
      hashSamples.push(performance.now() - t)
    }
    const sorted   = [...hashSamples].sort((a, b) => a - b)
    const hashCost = sorted[Math.floor(sorted.length / 2)]!

    const timeIt = async (email: string) => {
      const t0 = performance.now()
      await errOf(() => auth.register({ name: 'X', email, password: PW } as any))
      return performance.now() - t0
    }
    const taken: number[] = [], fresh: number[] = []
    for (let i = 0; i < 4; i++) {
      taken.push(await timeIt('u@t.local'))
      fresh.push(await timeIt(`new-${Date.now()}-${i}@t.local`))
    }

    const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]! }
    const takenMed = median(taken)
    const freshMed = median(fresh)
    const floor    = takenMed / hashCost
    const gap      = Math.abs(freshMed - takenMed)

    /* The gap is REPORTED, not asserted on. A first attempt at V3 kept a
       "generous" gap < hashCost companion and it failed on its own first
       outing — one hash here is ~200 ms, and two independently noisy ~250 ms
       measurements differ by more than that routinely. Any bound on the gap is
       a bound on machine noise, and the new-email path legitimately does more
       work anyway: it writes a user and starts two notifications. The floor is
       the property; the gap is context. */
    check(
      `the taken-email path pays a full bcrypt hash (${takenMed.toFixed(0)}ms = ${floor.toFixed(2)}x one ${hashCost.toFixed(0)}ms hash; skipping it reads ~0.01x. Gap to the new-email path, for information: ${gap.toFixed(0)}ms)`,
      floor >= 0.5,
      `${floor.toFixed(2)}x`,
    )
    check('DEFAULT mode: a taken address is still reported as taken (UX unchanged)',
      (await errOf(() => auth.register({ name: 'X', email: 'u@t.local', password: PW } as any))) === 'EMAIL_TAKEN')

    /* Verification-first makes the two outcomes literally identical — the only
       way to hide the signal, since a session is otherwise the giveaway. */
    process.env.SIGNUP_REQUIRE_VERIFICATION = 'true'
    const takenRes = await auth.register({ name: 'X', email: 'u@t.local', password: PW } as any)
    const freshRes = await auth.register({ name: 'X', email: `vf-${Date.now()}@t.local`, password: PW } as any)
    check('VERIFICATION-FIRST: a taken address returns "check your inbox", not an error',
      JSON.stringify(takenRes) === JSON.stringify({ verificationRequired: true }), JSON.stringify(takenRes))
    check('VERIFICATION-FIRST: a NEW address returns exactly the same thing',
      JSON.stringify(freshRes) === JSON.stringify(takenRes),
      `${JSON.stringify(freshRes)} vs ${JSON.stringify(takenRes)}`)
    check('VERIFICATION-FIRST: no session is issued, so there is nothing to distinguish',
      !('tokens' in (freshRes as object)))
    /* The account is still created — only unusable until the link is followed. */
    const created = await UserModel.countDocuments({ email: /^vf-/ })
    check('VERIFICATION-FIRST: the account IS created, just not usable yet', created === 1, `${created}`)
    delete process.env.SIGNUP_REQUIRE_VERIFICATION
  }

  /* ══ L-06 ══════════════════════════════════════════ */
  section('L-06 — a token is bound to the portal that issued it')
  {
    /* A device id on both logins. `u@t.local` is a student, and students are
       device-limited: a refresh whose meta carries no deviceId is now
       correctly rejected as DEVICE_REVOKED, which used to crash this suite on
       the rotation check below. Logging in with a device registers it — the
       first one for a user is auto-approved — so the rotation check exercises
       the real flow instead of a session that could not exist. */
    const DEVICE = 'claims-suite-device'
    const client: any = await auth.login({ email: 'u@t.local', password: PW }, { deviceId: DEVICE }, 'client')
    const admin:  any = await auth.login({ email: 'u@t.local', password: PW }, { deviceId: DEVICE }, 'admin')

    check('a client token carries aud=client',
      (await jwtUtil.verifyAccessToken(client.tokens.access_token)).aud === 'client')
    check('an admin token carries aud=admin',
      (await jwtUtil.verifyAccessToken(admin.tokens.access_token)).aud === 'admin')
    check('every token carries the issuer',
      (await jwtUtil.verifyAccessToken(client.tokens.access_token)).iss === jwtUtil.JWT_ISSUER)

    check('a client token is REFUSED where admin is expected',
      (await errOf(() => jwtUtil.verifyAccessToken(client.tokens.access_token, 'admin'))) !== 'ok')
    check('an admin token is REFUSED where client is expected',
      (await errOf(() => jwtUtil.verifyAccessToken(admin.tokens.access_token, 'client'))) !== 'ok')
    check('each token is accepted by its own portal',
      (await errOf(() => jwtUtil.verifyAccessToken(client.tokens.access_token, 'client'))) === 'ok' &&
      (await errOf(() => jwtUtil.verifyAccessToken(admin.tokens.access_token, 'admin'))) === 'ok')
    check('a shared endpoint (no expectation) accepts both',
      (await errOf(() => jwtUtil.verifyAccessToken(client.tokens.access_token))) === 'ok' &&
      (await errOf(() => jwtUtil.verifyAccessToken(admin.tokens.access_token))) === 'ok')

    /* Refresh tokens are bound too, so a client cookie cannot mint an admin session. */
    check('a client REFRESH token is refused at the admin portal',
      (await errOf(() => jwtUtil.verifyRefreshToken(client.tokens.refresh_token, 'admin'))) !== 'ok')

    /* Rotation must preserve the portal, or the first refresh downgrades it. */
    const rotated = await auth.refresh(admin.tokens.refresh_token, { deviceId: DEVICE }, 'admin')
    check('rotation preserves the audience',
      (await jwtUtil.verifyAccessToken(rotated.access_token)).aud === 'admin')

    section('L-06 rollout — existing sessions must survive the deploy')
    const legacy = await legacyAccessToken(uid, 'u@t.local', 'student')
    check('STAGE 1: a legacy token (no aud, no iss) still works',
      (await errOf(() => jwtUtil.verifyAccessToken(legacy, 'client'))) === 'ok')
    check('STAGE 1: it works on the admin portal too',
      (await errOf(() => jwtUtil.verifyAccessToken(legacy, 'admin'))) === 'ok')

    process.env.JWT_ENFORCE_AUDIENCE = 'true'
    check('STAGE 2: once enforcing, the legacy token is refused',
      (await errOf(() => jwtUtil.verifyAccessToken(legacy, 'client'))) !== 'ok')
    check('STAGE 2: correctly-tagged tokens are unaffected',
      (await errOf(() => jwtUtil.verifyAccessToken(client.tokens.access_token, 'client'))) === 'ok')
    check('STAGE 2: cross-portal use is still refused',
      (await errOf(() => jwtUtil.verifyAccessToken(client.tokens.access_token, 'admin'))) !== 'ok')
    delete process.env.JWT_ENFORCE_AUDIENCE
  }

  /* ══ L-09 ══════════════════════════════════════════ */
  section('L-09 — a per-user daily AI allowance (limit set to 3 for this run)')
  {
    /* The allowance is claimed inside chat(), so drive it through chat(). No
       model is running, so a message that PASSES the quota then fails at the
       LLM call — anything other than AI_DAILY_LIMIT means the quota let it
       through, which is exactly what we are measuring. hasLLM() returns true
       unconditionally, so the claim is genuinely reached rather than
       short-circuited before it. */
    const claimOne = () => errOf(() => ai.chat(uid, [], 'hello'))

    const outcomes: string[] = []
    for (let i = 0; i < 5; i++) outcomes.push(await claimOne())
    const allowed = outcomes.filter(o => o !== 'AI_DAILY_LIMIT').length
    const limited = outcomes.filter(o => o === 'AI_DAILY_LIMIT').length
    check('exactly 3 messages are allowed and the rest refused',
      allowed === 3 && limited === 2, `allowed=${allowed} limited=${limited} :: ${outcomes.join(', ')}`)

    const doc = await UserModel.findById(uid).lean() as any
    check('usage is recorded on the account, so it survives a restart',
      doc?.aiUsage?.count >= 3 && typeof doc?.aiUsage?.day === 'string',
      JSON.stringify(doc?.aiUsage))

    /* A new day must reset the allowance. */
    await UserModel.findByIdAndUpdate(uid, { $set: { aiUsage: { day: '2000-01-01', count: 999 } } })
    const afterRollover = await claimOne()
    check('a new day resets the allowance', afterRollover !== 'AI_DAILY_LIMIT', afterRollover)

    /* 0 disables the cap entirely. */
    process.env.AI_DAILY_MESSAGE_LIMIT = '0'
    await UserModel.findByIdAndUpdate(uid, { $set: { aiUsage: { day: new Date().toLocaleDateString('en-CA'), count: 9999 } } })
    check('AI_DAILY_MESSAGE_LIMIT=0 disables the cap', (await claimOne()) !== 'AI_DAILY_LIMIT')
    process.env.AI_DAILY_MESSAGE_LIMIT = '3'
  }

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
