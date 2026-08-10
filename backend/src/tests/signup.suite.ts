/* ─────────────────────────────────────────────────────────────
   M-05 — a full signup completes without ever holding a session.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_signup_suite), dropped on exit. The real `lms` database is never opened.

   Why this suite exists. M-05's remaining half was verification-first signup:
   issue no session at registration, so a taken address and a fresh one answer
   identically. The mechanism was built and left OFF, because the full signup
   form uploaded a passport, an ID document and a profile photo AFTER
   registering — using exactly the session verification-first withholds. Turned
   on as it stood, all three uploads and both profile patches would have 401'd
   and every applicant's identity documents would have vanished silently.

   The documents now go up BEFORE the account exists, through
   POST /uploads/signup-doc, and their references travel in with the register
   payload. Phase D is the whole finding: with SIGNUP_REQUIRE_VERIFICATION on,
   registration returns no cookie at all AND the stored user still carries all
   three documents.

   Phase B is the other half of the bill. That endpoint had to be mounted above
   this router's `authenticateAny`, and getting that wrong would silently open
   every other upload route to anonymous callers.

   Run: bun run test:signup
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_signup_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.BACKEND_PUBLIC_URL = 'http://127.0.0.1:8000'
/* Force the local-disk fallback. Set BEFORE anything imports the env config —
   dotenv never overwrites a key that is already present, and `opt()` reads an
   empty string as unset. Without this the suite would write test fixtures into
   the production R2 bucket. */
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''
/* Room for the phases below; phase G then walks the bucket down to empty. */
process.env.RATE_LIMIT_SIGNUP_UPLOAD_MAX = '20'
process.env.RATE_LIMIT_AUTH_MAX          = '200'
delete process.env.SIGNUP_REQUIRE_VERIFICATION

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const fs   = await import('fs/promises')
const path = await import('path')
const app  = (await import('@/app.ts')).default
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_signup_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* Minimal files that pass the magic-byte check — only the leading bytes are
   inspected, so there is no need to carry a real image around. */
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
const PDF  = Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.alloc(64)])
const LIAR = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64)])   // declared PNG, is not
const HUGE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(3.2 * 1024 * 1024)])

/** Every reference this suite stored, so the local files can be removed. */
const stored: string[] = []

async function uploadSignupDoc(
  buf: Buffer, type: string, kind: string, opts: { cookie?: string; name?: string } = {},
) {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(buf)], { type }), opts.name ?? 'f.png')
  fd.append('kind', kind)
  const headers: Record<string, string> = {}
  if (opts.cookie) headers['cookie'] = opts.cookie
  const res  = await fetch(`${BASE}/uploads/signup-doc`, { method: 'POST', body: fd, headers })
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  if (body?.data?.key) stored.push(body.data.key)
  return { status: res.status, body }
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed, setCookie: res.headers.getSetCookie?.() ?? [] }
}

/** The stored reference, or an empty string if the upload was refused.
 *  Reading .data.url straight off a failed response throws, which turns a
 *  regression into a stack trace instead of a named failure — that is how the
 *  "mounted below the auth gate" mutation first crashed this suite. */
const refOf = (r: { body: any }): string => r.body?.data?.url ?? ''

const PW = 'CorrectHorse1'
const fullSignup = (email: string, docs: { passportUrl: string; idDocUrl: string; photoUrl: string }) => ({
  name: 'Applicant Person', email, password: PW,
  signupType: 'full', organizationSlug: 'dubai',
  enrollmentApplication: {
    ...docs,
    phone: '+971500000000', gender: 'Male', nationality: 'India',
    homeCountry: 'India', occupation: 'Engineer', idType: 'passport',
    idNumber: 'X1234567', city: 'Dubai', experienceLevel: 'Beginner',
  },
})

try {
  await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  section('A — the pre-registration upload works with NO session, and is bounded')
  {
    const kyc = await uploadSignupDoc(PNG, 'image/png', 'kyc')
    check('an anonymous caller can store an identity scan', kyc.status === 201, `got ${kyc.status}`)
    check('it returns a bare kyc/ key, never a fetchable URL',
      typeof kyc.body?.data?.url === 'string' &&
      kyc.body.data.url.startsWith('kyc/') && !kyc.body.data.url.includes('://'),
      kyc.body?.data?.url)

    const photo = await uploadSignupDoc(PNG, 'image/png', 'photo')
    check('kind=photo stores the avatar where it can be rendered', photo.status === 201, `got ${photo.status}`)
    check('...and that one IS a URL under our own host',
      typeof photo.body?.data?.url === 'string' &&
      photo.body.data.url.startsWith('http://127.0.0.1:8000/uploads/documents/'),
      photo.body?.data?.url)

    const wrongType = await uploadSignupDoc(PNG, 'text/plain', 'kyc', { name: 'f.txt' })
    check('a disallowed type is refused', wrongType.status === 400, `got ${wrongType.status}`)

    const liar = await uploadSignupDoc(LIAR, 'image/png', 'kyc')
    check('bytes that do not match the declared type are refused',
      liar.status === 400 && liar.body?.error?.code === 'UPLOAD_ERROR',
      `got ${liar.status} ${liar.body?.error?.code}`)

    const huge = await uploadSignupDoc(HUGE, 'image/png', 'kyc')
    check('a file over the 3 MB cap is refused', huge.status === 400, `got ${huge.status}`)

    /* A PDF is right for a passport and wrong for the one thing this route
       stores publicly and renders as an <img>. */
    const pdfAsKyc = await uploadSignupDoc(PDF, 'application/pdf', 'kyc', { name: 'p.pdf' })
    check('a PDF is accepted as an identity scan', pdfAsKyc.status === 201, `got ${pdfAsKyc.status}`)
    const pdfAsPhoto = await uploadSignupDoc(PDF, 'application/pdf', 'photo', { name: 'p.pdf' })
    check('...but refused as a public profile photo',
      pdfAsPhoto.status === 400 && pdfAsPhoto.body?.error?.code === 'UPLOAD_ERROR',
      `got ${pdfAsPhoto.status} ${pdfAsPhoto.body?.error?.code}`)

    /* `kind` is repeatable in multipart; two values must not read as 'photo'. */
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'f.png')
    fd.append('kind', 'photo')
    fd.append('kind', 'x')
    const dup = await fetch(`${BASE}/uploads/signup-doc`, { method: 'POST', body: fd })
    const dupBody: any = await dup.json().catch(() => ({}))
    if (dupBody?.data?.key) stored.push(dupBody.data.key)
    check('a repeated `kind` field falls back to the PRIVATE prefix, not the public one',
      dup.status !== 201 || String(dupBody?.data?.url ?? '').startsWith('kyc/'),
      `${dup.status} ${dupBody?.data?.url}`)
  }

  section('B — the other upload routes are STILL authenticated  ← the regression this risked')
  {
    /* /uploads/signup-doc had to be mounted above this router's blanket
       authenticateAny. Mount it one line too low and it 401s; mount the
       authenticateAny one line too low and every upload route opens up. */
    const probes: [string, Buffer, string][] = [
      ['/uploads/document', PDF, 'application/pdf'],
      ['/uploads/kyc',      PNG, 'image/png'],
      ['/uploads/image',    PNG, 'image/png'],
    ]
    for (const [route, buf, type] of probes) {
      const fd = new FormData()
      fd.append('file', new Blob([new Uint8Array(buf)], { type }), 'f.bin')
      const res = await fetch(`${BASE}${route}`, { method: 'POST', body: fd })
      check(`${route} still refuses an anonymous caller`, res.status === 401, `got ${res.status}`)
      /* Normally these 401 and write nothing. Under a mutation that opens the
         route they succeed — record what they stored so the failing run still
         cleans up after itself rather than littering the working tree. */
      if (res.status === 201) {
        try { const j: any = await res.json(); if (j?.data?.key) stored.push(j.data.key) } catch {}
      }
    }
    const presign = await fetch(`${BASE}/uploads/presign`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'x.mp4', contentType: 'video/mp4' }),
    })
    check('/uploads/presign still refuses an anonymous caller', presign.status === 401, `got ${presign.status}`)
  }

  section('C — default mode: one request carries the whole application')
  {
    const passportUrl = refOf(await uploadSignupDoc(PNG, 'image/png', 'kyc'))
    const idDocUrl    = refOf(await uploadSignupDoc(PDF, 'application/pdf', 'kyc', { name: 'id.pdf' }))
    const photoUrl    = refOf(await uploadSignupDoc(PNG, 'image/png', 'photo'))

    const r = await post('/auth/register', fullSignup('full-default@t.local', { passportUrl, idDocUrl, photoUrl }))
    check('registration succeeds', r.status === 201, `got ${r.status} ${JSON.stringify(r.body?.error ?? '')}`)
    check('default mode still signs the new user straight in',
      r.setCookie.some(c => c.startsWith('lms_at=') && !c.startsWith('lms_at=;')))

    const user = await UserModel.findOne({ email: 'full-default@t.local' }).lean()
    check('the passport reference is stored', user?.enrollmentApplication?.passportUrl === passportUrl,
      user?.enrollmentApplication?.passportUrl)
    check('the ID document reference is stored', user?.enrollmentApplication?.idDocUrl === idDocUrl)
    check('the photo reference is stored', user?.enrollmentApplication?.photoUrl === photoUrl)
    check('the avatar is set from the photo, with no follow-up PATCH /auth/me',
      user?.avatarUrl === photoUrl, user?.avatarUrl)
    check('it is recorded as a full signup, pending approval',
      user?.signupType === 'full' && user?.enrollmentStatus === 'pending')
  }

  section('D — verification-first: no session, and NOTHING is lost  ← the finding')
  {
    process.env.SIGNUP_REQUIRE_VERIFICATION = 'true'

    /* The three uploads that used to need the session registration no longer
       hands back. This is the step that used to be impossible. */
    const passportUrl = refOf(await uploadSignupDoc(PNG, 'image/png', 'kyc'))
    const idDocUrl    = refOf(await uploadSignupDoc(PDF, 'application/pdf', 'kyc', { name: 'id.pdf' }))
    const photoUrl    = refOf(await uploadSignupDoc(PNG, 'image/png', 'photo'))
    check('all three documents store with no session in hand',
      !!passportUrl && !!idDocUrl && !!photoUrl)

    const r = await post('/auth/register', fullSignup('full-verify@t.local', { passportUrl, idDocUrl, photoUrl }))
    check('registration is accepted', r.status === 201, `got ${r.status}`)
    check('it answers verificationRequired', r.body?.data?.verificationRequired === true, JSON.stringify(r.body?.data))
    check('NO session cookie is issued', !r.setCookie.some(c => c.startsWith('lms_at=') && !c.startsWith('lms_at=;')),
      r.setCookie.join(' | '))

    const user = await UserModel.findOne({ email: 'full-verify@t.local' }).lean()
    check('the account exists', !!user)
    check('the passport survived', user?.enrollmentApplication?.passportUrl === passportUrl)
    check('the ID document survived', user?.enrollmentApplication?.idDocUrl === idDocUrl)
    check('the avatar survived', user?.avatarUrl === photoUrl)

    /* And the property the whole finding is about: a taken address answers
       exactly as a new one does, so registration reveals nothing. */
    const again = await post('/auth/register', fullSignup('full-verify@t.local', { passportUrl, idDocUrl, photoUrl }))
    check('a second attempt on the SAME address answers identically',
      again.status === r.status && JSON.stringify(again.body?.data) === JSON.stringify(r.body?.data),
      `${again.status} ${JSON.stringify(again.body?.data)}`)
    check('...and still issues no cookie',
      !again.setCookie.some(c => c.startsWith('lms_at=') && !c.startsWith('lms_at=;')))
    check('...and did not create a duplicate account',
      await UserModel.countDocuments({ email: 'full-verify@t.local' }) === 1)

    delete process.env.SIGNUP_REQUIRE_VERIFICATION
  }

  section('E — express signup, which carries no documents, is untouched')
  {
    const r = await post('/auth/register', {
      name: 'Express Person', email: 'express@t.local', password: PW,
      signupType: 'express', organizationSlug: 'bangalore',
      enrollmentApplication: { homeCountry: 'India' },
    })
    check('express signup still succeeds', r.status === 201, `got ${r.status}`)
    check('express signup still signs the user in',
      r.setCookie.some(c => c.startsWith('lms_at=') && !c.startsWith('lms_at=;')))
    const user = await UserModel.findOne({ email: 'express@t.local' }).lean()
    check('no avatar is invented when no photo was sent', !user?.avatarUrl, user?.avatarUrl)
    check('it lands in the academy it asked for', !!user?.organizationId)
  }

  section('F — the references are still validated, so this is not a free-text field')
  {
    const foreign = await post('/auth/register', fullSignup('foreign@t.local', {
      passportUrl: 'https://evil.example.com/passport.png',
      idDocUrl: 'kyc/whatever.png', photoUrl: 'kyc/whatever.png',
    }))
    check('a reference pointing at someone else\'s host is refused',
      foreign.status === 422 && foreign.body?.error?.code === 'VALIDATION_ERROR',
      `got ${foreign.status} ${foreign.body?.error?.code}`)
    check('...and no account was created',
      await UserModel.countDocuments({ email: 'foreign@t.local' }) === 0)

    const traversal = await post('/auth/register', fullSignup('traversal@t.local', {
      passportUrl: 'kyc/../../etc/passwd', idDocUrl: 'kyc/x.png', photoUrl: 'kyc/x.png',
    }))
    check('a traversal attempt in the key is refused',
      traversal.status === 422 && traversal.body?.error?.code === 'VALIDATION_ERROR',
      `got ${traversal.status} ${traversal.body?.error?.code}`)
  }

  section('G — the anonymous endpoint is rate-limited  ← its only real abuse surface')
  {
    let limited: { status: number; body: any } | null = null
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await uploadSignupDoc(PNG, 'image/png', 'kyc')
      if (r.status === 429) limited = r
    }
    check('repeated anonymous uploads are eventually refused', !!limited, 'no 429 within 40 attempts')
    check('...with RATE_LIMITED rather than a generic error',
      limited?.body?.error?.code === 'RATE_LIMITED', limited?.body?.error?.code)
  }

} finally {
  /* Remove the fixtures this suite wrote to local disk. */
  let removed = 0
  for (const key of stored) {
    if (typeof key !== 'string' || key.includes('..')) continue
    const rel = key.includes('://') ? key.split('/uploads/')[1] : key
    if (!rel) continue
    try { await fs.unlink(path.join(process.cwd(), 'uploads', rel)); removed++ } catch {}
  }
  lines.push(`\n(cleanup: removed ${removed} local upload fixture(s))`)
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
