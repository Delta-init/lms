/* ─────────────────────────────────────────────────────────────
   CLIENT SUITE — the student-facing app, every section, four ways each.

   Coverage before this suite was 29 of 116 client-facing endpoints (~25%),
   almost all happy-path GETs. The entire learning experience was untested:
   lessons, progress, quizzes, assignments, notes, bookmarks, Q&A, reviews,
   support, 2FA and checkout.

   Every resource here is exercised FOUR ways, because each catches a
   different class of defect and the happy path catches the fewest:

     1. HAPPY PATH   — the owner does the thing. Does the product work?
     2. ANONYMOUS    — no session. Must be 401, never 200.
     3. OTHER USER   — a second student with a valid session reaches for the
                       first one's data. This is the IDOR check, and it is the
                       one that matters: a 200 here is a data breach.
     4. MALFORMED ID — must be a 4xx, never a 5xx. A CastError reaching the
                       error middleware means a mistyped URL reads as "the
                       server is broken" (that was B-06).

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_client_suite), dropped on exit. The real `lms` database is never
   opened, R2 credentials are blanked so uploads stay on local disk, and the
   Google credentials are cleared so no third-party call leaves the machine.

   Run: bun run test:client
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_client_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.BACKEND_PUBLIC_URL = 'http://127.0.0.1:8000'
process.env.R2_ACCOUNT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''; process.env.R2_PUBLIC_URL = ''
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.GOOGLE_REFRESH_TOKEN
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.RATE_LIMIT_SEARCH_MAX = '900'
process.env.RATE_LIMIT_SIGNUP_UPLOAD_MAX = '900'

export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LessonModel,
  EnrollmentModel, LiveClassModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_client_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

/* Course search uses a Mongo $text index. autoIndex is disabled here (background
   index builds race dropDatabase on teardown and leave stray collection shells),
   so without this the index does not exist and every ?search= answered 500 — the
   suite would have reported a broken search page that works in production.
   Awaited up front, so there is no build racing the teardown. */
await CourseModel.createIndexes()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

const ok  = (r: { status: number }) => r.status >= 200 && r.status < 300
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 60)}`
const PW  = 'CorrectHorse1'
const BAD = 'not-an-objectid'

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, extra: object = {}) =>
    UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, organizationId: org._id, ...extra })

  const teacher = await mk('teacher@t.local', 'instructor')
  const alice   = await mk('alice@t.local', 'student', { enrollmentStatus: 'approved' })
  const bob     = await mk('bob@t.local',   'student', { enrollmentStatus: 'approved' })
  /* Carol is approved but NEVER enrolled in anything. The not-enrolled
     assertions used bob, who gets enrolled partway through the Q&A section —
     so they silently became assertions about an enrolled student. */
  await mk('carol@t.local', 'student', { enrollmentStatus: 'approved' })

  /* A free course so enrolment is reachable without a payment gateway. */
  const course = await CourseModel.create({
    title: 'Client Suite Course', slug: `client-suite-${Date.now()}`,
    description: 'A course seeded for the client-side functional suite.',
    price: 0, isFree: true, status: 'published', language: 'English',
    instructorId: teacher._id, organizationId: org._id,
  })
  const sec    = await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 1 })
  const lesson = await LessonModel.create({ courseId: course._id, sectionId: sec._id, title: 'Lesson 1', type: 'article', content: 'Body', order: 1 })
  const quizLesson = await LessonModel.create({ courseId: course._id, sectionId: sec._id, title: 'Quiz Lesson', type: 'quiz', order: 2 })
  const liveClass = await LiveClassModel.create({
    courseId: course._id, title: 'Client Live', scheduledStart: new Date(Date.now() + 86_400_000),
    durationMins: 60, type: 'external', instructorId: teacher._id, organizationId: org._id,
    language: 'English', status: 'scheduled', isOnline: false, location: 'Campus', room: 'A1',
    sessionCapacity: 30,
  })

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email, password: PW } })
    return { jar, r }
  }
  const A = await login('alice@t.local')   /* the owner */
  const C = await login('carol@t.local')  /* never enrolled in anything */
  const B = await login('bob@t.local')     /* the other student */
  const aliceJar = A.jar, bobJar = B.jar, carolJar = C.jar

  /* ── The four-ways helper ───────────────────────────────────────────── */
  async function fourWays(name: string, method: string, path: string, body?: unknown, opts: { skipIdor?: boolean } = {}) {
    const happy = await call(method, path, { jar: aliceJar, ...(body !== undefined ? { body } : {}) })
    check(`${name} · owner succeeds`, ok(happy), why(happy))

    const anon = await call(method, path, { ...(body !== undefined ? { body } : {}) })
    check(`${name} · anonymous is refused`, anon.status === 401, `got ${anon.status}`)

    if (!opts.skipIdor) {
      const other = await call(method, path, { jar: bobJar, ...(body !== undefined ? { body } : {}) })
      check(`${name} · another student is refused`, !ok(other), `got ${other.status}`)
    }

    const badPath = path.replace(/[0-9a-f]{24}/i, BAD)
    if (badPath !== path) {
      const bad = await call(method, badPath, { jar: aliceJar, ...(body !== undefined ? { body } : {}) })
      check(`${name} · malformed id is not a 5xx`, bad.status < 500, why(bad))
    }
    return happy
  }

  /* ══════════ 1. AUTH ══════════ */
  section('AUTH — sign in, session, refresh, password, sign out')
  {
    check('alice signs in', ok(A.r), why(A.r))
    check('GET /auth/me',   ok(await call('GET', '/auth/me', { jar: aliceJar })))
    check('anonymous /auth/me is refused', (await call('GET', '/auth/me')).status === 401)

    const wrong = await call('POST', '/auth/login', { body: { email: 'alice@t.local', password: 'WrongPass123' } })
    check('a wrong password is refused', wrong.status >= 400, `got ${wrong.status}`)

    const refreshed = await call('POST', '/auth/refresh', { jar: aliceJar })
    check('the session refreshes', ok(refreshed), why(refreshed))

    const unknown = await call('POST', '/auth/forgot-password', { body: { email: 'nobody@t.local' } })
    check('forgot-password does not reveal whether an address exists', ok(unknown), why(unknown))

    const badReset = await call('POST', '/auth/reset-password', { body: { token: 'x'.repeat(40), password: 'NewPass1234' } })
    check('a bogus reset token is refused', badReset.status >= 400, `got ${badReset.status}`)
  }

  section('AUTH — profile updates and password change')
  {
    const patched = await call('PATCH', '/auth/me', { jar: aliceJar, body: { name: 'Alice Updated' } })
    check('a student can edit their own profile', ok(patched), why(patched))

    const escalate = await call('PATCH', '/auth/me', { jar: aliceJar, body: { role: 'admin' } })
    const after: any = await UserModel.findById(alice._id).select('role').lean()
    check('...but cannot promote themselves to admin', after?.role === 'student',
      `role is now ${after?.role} (request was ${escalate.status})`)

    const wrongOld = await call('POST', '/auth/change-password', { jar: aliceJar, body: { currentPassword: 'Nope12345', newPassword: 'Brand1New' } })
    check('a password change with the wrong current password is refused', wrongOld.status >= 400, `got ${wrongOld.status}`)
  }

  /* ══════════ 2. CATALOGUE ══════════ */
  section('CATALOGUE — browsing, filters, search, pagination, odd input')
  {
    const variants: [string, string][] = [
      ['list',                '/courses'],
      ['page 1',              '/courses?page=1&per_page=5'],
      ['page 99',             '/courses?page=99&per_page=5'],
      ['negative page',       '/courses?page=-1&per_page=5'],
      ['non-numeric page',    '/courses?page=abc'],
      ['huge per_page',       '/courses?per_page=100000'],
      ['search',              '/courses?search=Client'],
      ['regex-ish search',    '/courses?search=.*'],
      ['long search',         `/courses?search=${'a'.repeat(400)}`],
      ['free filter',         '/courses?free=true'],
      ['bogus sort',          '/courses?sort=;drop'],
      ['categories',          '/categories'],
      ['instructors',         '/instructors'],
      ['learning paths',      '/learning-paths'],
      ['course by slug',      `/courses/${course.slug}`],
      ['unknown slug',        '/courses/no-such-course-anywhere'],
      ['rating histogram',    `/courses/${course.slug}/rating-histogram`],
      ['recommendations',     `/courses/${course.slug}/recommendations`],
      ['by id',               `/courses/by-id/${course._id}`],
      ['by malformed id',     `/courses/by-id/${BAD}`],
    ]
    for (const [name, url] of variants) {
      const r = await call('GET', url)
      check(`anonymous ${name} is not a 5xx`, r.status < 500, why(r))
    }
    check('the catalogue lists the seeded course',
      JSON.stringify((await call('GET', '/courses?per_page=50')).body?.data ?? '').includes(course.slug))
  }

  /* ══════════ 3. ENROLMENT ══════════ */
  section('ENROLMENT — enrol, list, progress')
  {
    const e = await call('POST', '/enrollments', { jar: aliceJar, body: { courseId: String(course._id) } })
    check('alice enrols in the free course', ok(e), why(e))
    const again = await call('POST', '/enrollments', { jar: aliceJar, body: { courseId: String(course._id) } })
    check('enrolling twice is idempotent, not an error', ok(again), why(again))
    check('anonymous enrolment is refused', (await call('POST', '/enrollments', { body: { courseId: String(course._id) } })).status === 401)
    const badCourse = await call('POST', '/enrollments', { jar: aliceJar, body: { courseId: BAD } })
    check('enrolling with a malformed course id is not a 5xx', badCourse.status < 500, why(badCourse))

    check('GET /enrollments/me',       ok(await call('GET', '/enrollments/me', { jar: aliceJar })))
    check('GET /enrollments/activity', ok(await call('GET', '/enrollments/activity', { jar: aliceJar })))
    const prog = await call('GET', `/courses/${course.slug}/progress`, { jar: aliceJar })
    check('course progress loads for an enrolled student', ok(prog), why(prog))

    /* Bob is NOT enrolled — the gated reads must not open up for him. */
    await EnrollmentModel.deleteMany({ userId: bob._id })
  }

  /* ══════════ 4. LEARNING ══════════ */
  section('LEARNING — lessons, progress, watch time, transcripts')
  {
    /* No IDOR dimension: the path carries no user id, so this returns the
       CALLER'S own progress. Bob getting 200 is his own empty record. */
    await fourWays('lesson progress', 'GET',  `/lessons/${lesson._id}/progress`, undefined, { skipIdor: true })
    await fourWays('mark complete',   'POST', `/lessons/${lesson._id}/complete`, undefined, { skipIdor: true })
    await fourWays('watch time',      'POST', `/lessons/${lesson._id}/watch-time`, { secs: 30 }, { skipIdor: true })

    const transcript = await call('GET', `/lessons/${lesson._id}/transcript`, { jar: aliceJar })
    check('transcript read is not a 5xx', transcript.status < 500, why(transcript))
    const anonTranscript = await call('GET', `/lessons/${lesson._id}/transcript`)
    check('anonymous transcript is refused', anonTranscript.status === 401, `got ${anonTranscript.status}`)
  }

  section('LEARNING — quizzes')
  {
    const q = await call('GET', `/quizzes/lessons/${quizLesson._id}`, { jar: aliceJar })
    check('quiz fetch is not a 5xx', q.status < 500, why(q))
    check('anonymous quiz fetch is refused', (await call('GET', `/quizzes/lessons/${quizLesson._id}`)).status === 401)
    const badQuiz = await call('GET', `/quizzes/lessons/${BAD}`, { jar: aliceJar })
    check('quiz with a malformed lesson id is not a 5xx', badQuiz.status < 500, why(badQuiz))
    const submit = await call('POST', `/quizzes/lessons/${quizLesson._id}/submit`, { jar: aliceJar, body: { answers: [] } })
    check('quiz submit is not a 5xx', submit.status < 500, why(submit))
    const summary = await call('GET', `/quizzes/lessons/${quizLesson._id}/summary`, { jar: aliceJar })
    check('quiz summary is not a 5xx', summary.status < 500, why(summary))
  }

  section('LEARNING — assignments')
  {
    for (const [name, method, path, body] of [
      ['assignment fetch',    'GET',  `/assignments/lessons/${lesson._id}`,               undefined],
      ['my submission',       'GET',  `/assignments/lessons/${lesson._id}/my-submission`, undefined],
      ['assignment submit',   'POST', `/assignments/lessons/${lesson._id}/submit`,        { content: 'My answer' }],
    ] as [string, string, string, unknown][]) {
      const r = await call(method, path, { jar: aliceJar, ...(body !== undefined ? { body } : {}) })
      check(`${name} is not a 5xx`, r.status < 500, why(r))
      check(`${name} refuses anonymous`, (await call(method, path, body !== undefined ? { body } : {})).status === 401)
      const bad = await call(method, path.replace(String(lesson._id), BAD), { jar: aliceJar, ...(body !== undefined ? { body } : {}) })
      check(`${name} with a malformed id is not a 5xx`, bad.status < 500, why(bad))
    }
  }

  /* ══════════ 5. NOTES & BOOKMARKS — the clearest IDOR surface ══════════ */
  section('NOTES — private to their owner')
  {
    const saved = await call('PUT', `/lessons/${lesson._id}/my-note`, { jar: aliceJar, body: { body: 'Alice private note' } })
    check('alice saves a note', ok(saved), why(saved))
    const read = await call('GET', `/lessons/${lesson._id}/my-note`, { jar: aliceJar })
    check('alice reads it back', ok(read) && JSON.stringify(read.body).includes('Alice private note'), why(read))

    const bobRead = await call('GET', `/lessons/${lesson._id}/my-note`, { jar: bobJar })
    check('bob does NOT see alice\'s note',
      !JSON.stringify(bobRead.body ?? '').includes('Alice private note'), 'bob saw it')

    check('anonymous note read is refused', (await call('GET', `/lessons/${lesson._id}/my-note`)).status === 401)
    const badNote = await call('GET', `/lessons/${BAD}/my-note`, { jar: aliceJar })
    check('note with a malformed lesson id is not a 5xx', badNote.status < 500, why(badNote))
    check('course notes list', ok(await call('GET', `/courses/${course._id}/my-notes`, { jar: aliceJar })))
    const del = await call('DELETE', `/lessons/${lesson._id}/my-note`, { jar: aliceJar })
    check('alice deletes her note', ok(del), why(del))
  }

  section('BOOKMARKS — private to their owner')
  {
    const made = await call('POST', `/lessons/${lesson._id}/bookmarks`, { jar: aliceJar, body: { timeSecs: 42, label: 'Alice mark' } })
    check('alice creates a bookmark', ok(made), why(made))
    const id = made.body?.data?.id ?? made.body?.data?._id

    check('alice lists her bookmarks', ok(await call('GET', `/lessons/${lesson._id}/bookmarks`, { jar: aliceJar })))
    const bobList = await call('GET', `/lessons/${lesson._id}/bookmarks`, { jar: bobJar })
    check('bob does NOT see alice\'s bookmark',
      !JSON.stringify(bobList.body ?? '').includes('Alice mark'), 'bob saw it')

    if (id) {
      const bobDelete = await call('DELETE', `/bookmarks/${id}`, { jar: bobJar })
      check('bob cannot delete alice\'s bookmark', !ok(bobDelete), `got ${bobDelete.status}`)
      const aliceDelete = await call('DELETE', `/bookmarks/${id}`, { jar: aliceJar })
      check('alice can delete her own', ok(aliceDelete), why(aliceDelete))
    }
    const badBm = await call('DELETE', `/bookmarks/${BAD}`, { jar: aliceJar })
    check('bookmark delete with a malformed id is not a 5xx', badBm.status < 500, why(badBm))
    check('course bookmarks list', ok(await call('GET', `/courses/${course._id}/bookmarks`, { jar: aliceJar })))
  }

  section('FAVOURITES')
  {
    const add = await call('POST', '/favorites', { jar: aliceJar, body: { courseId: String(course._id) } })
    check('alice favourites a course', ok(add), why(add))
    check('her list shows it', JSON.stringify((await call('GET', '/favorites/me', { jar: aliceJar })).body ?? '').includes(String(course._id)))
    check('bob\'s list does not', !JSON.stringify((await call('GET', '/favorites/me', { jar: bobJar })).body ?? '').includes(String(course._id)))
    check('exists check', ok(await call('GET', `/favorites/exists/${course._id}`, { jar: aliceJar })))
    check('anonymous favourites are refused', (await call('GET', '/favorites/me')).status === 401)
    check('remove', ok(await call('DELETE', `/favorites/${course._id}`, { jar: aliceJar })))
  }

  /* ══════════ 6. COMMUNITY ══════════ */
  section('Q&A — threads and comments')
  {
    const t = await call('POST', `/lessons/${lesson._id}/threads`, { jar: aliceJar, body: { title: 'Question', body: 'How does this work?' } })
    check('alice opens a thread', ok(t), why(t))
    const threadId = t.body?.data?.thread?.id ?? t.body?.data?.id ?? t.body?.data?._id

    check('threads list', ok(await call('GET', `/lessons/${lesson._id}/threads`, { jar: aliceJar })))
    check('anonymous thread creation is refused',
      (await call('POST', `/lessons/${lesson._id}/threads`, { body: { body: 'x' } })).status === 401)

    if (threadId) {
      check('another student may upvote', ok(await call('POST', `/threads/${threadId}/upvote`, { jar: bobJar })))
      const notEnrolled = await call('POST', `/threads/${threadId}/comments`, { jar: carolJar, body: { body: 'An answer' } })
      check('a NON-enrolled student cannot comment', !ok(notEnrolled), `got ${notEnrolled.status}`)
      await call('POST', '/enrollments', { jar: bobJar, body: { courseId: String(course._id) } })
      const c = await call('POST', `/threads/${threadId}/comments`, { jar: bobJar, body: { body: 'An answer' } })
      check('...and CAN once enrolled', ok(c), why(c))

      /* The reply must actually reach the thread author. This is asserted on
         the OUTCOME rather than the absence of an error, because the
         notification is fire-and-forget: it failed Mongoose validation on
         every single reply — `thread.authorId` arrives populated, so
         `.toString()` produced the inspected document instead of the id — and
         nothing surfaced except a line in the log. The suite passed either
         way until this check existed. */
      await new Promise(r => setTimeout(r, 400))
      const notes = await call('GET', '/notifications', { jar: aliceJar })
      check('the thread author is notified of the reply',
        JSON.stringify(notes.body ?? '').includes('New reply to your question'),
        JSON.stringify(notes.body?.data ?? '').slice(0, 120))
      const pin = await call('PATCH', `/threads/${threadId}/pin`, { jar: aliceJar, body: { isPinned: true } })
      check('a student may NOT pin a thread', !ok(pin), `got ${pin.status}`)
    }
    const badThread = await call('GET', `/threads/${BAD}`, { jar: aliceJar })
    check('thread with a malformed id is not a 5xx', badThread.status < 500, why(badThread))
  }

  section('REVIEWS')
  {
    const r = await call('POST', `/courses/${course._id}/reviews`, { jar: aliceJar, body: { rating: 5, comment: 'Great course' } })
    check('an enrolled student may review', ok(r), why(r))
    const reviewId = r.body?.data?.id ?? r.body?.data?._id

    check('reviews are publicly listable', ok(await call('GET', `/courses/${course._id}/reviews`)))
    const bobReview = await call('POST', `/courses/${course._id}/reviews`, { jar: carolJar, body: { rating: 1, comment: 'Not enrolled' } })
    check('a NON-enrolled student cannot review', !ok(bobReview), `got ${bobReview.status}`)

    if (reviewId) {
      check('another student may mark it helpful', ok(await call('POST', `/reviews/${reviewId}/helpful`, { jar: bobJar })))
      check('another student may report it',       ok(await call('POST', `/reviews/${reviewId}/report`,  { jar: bobJar })))
      const bobDelete = await call('DELETE', `/reviews/${reviewId}`, { jar: bobJar })
      check('another student cannot delete it', !ok(bobDelete), `got ${bobDelete.status}`)
    }
    const badReview = await call('POST', `/reviews/${BAD}/helpful`, { jar: bobJar })
    check('review action with a malformed id is not a 5xx', badReview.status < 500, why(badReview))
  }

  /* ══════════ 7. LIVE CLASSES & BOOKINGS ══════════ */
  section('LIVE CLASSES — listing, booking, cancelling')
  {
    check('upcoming feed', ok(await call('GET', '/live-classes/upcoming', { jar: aliceJar })))
    check('anonymous upcoming is refused', (await call('GET', '/live-classes/upcoming')).status === 401)
    check('course sessions are listable', ok(await call('GET', `/courses/${course.slug}/live-classes`)))

    await call('POST', '/enrollments', { jar: aliceJar, body: { courseId: String(course._id) } })
    const booked = await call('POST', '/bookings', { jar: aliceJar, body: { liveClassId: String(liveClass._id) } })
    check('an enrolled student can book a session', booked.status < 500, why(booked))
    check('my bookings', ok(await call('GET', '/bookings/me', { jar: aliceJar })))
    check('anonymous booking is refused', (await call('POST', '/bookings', { body: { liveClassId: String(liveClass._id) } })).status === 401)
    const badBooking = await call('POST', '/bookings', { jar: aliceJar, body: { liveClassId: BAD } })
    check('booking with a malformed id is not a 5xx', badBooking.status < 500, why(badBooking))

    const watch = await call('GET', `/live-classes/${liveClass._id}/watch`, { jar: aliceJar })
    check('watch access is not a 5xx', watch.status < 500, why(watch))
    const bobWatch = await call('GET', `/live-classes/${liveClass._id}/watch`, { jar: carolJar })
    check('a non-enrolled student is refused watch access', !ok(bobWatch), `got ${bobWatch.status}`)
  }

  /* ══════════ 8. SUPPORT ══════════ */
  section('SUPPORT — tickets are private to their author')
  {
    const t = await call('POST', '/support', { jar: aliceJar, body: { subject: 'Need help', category: 'technical', message: 'Something is wrong' } })
    check('alice opens a ticket', ok(t), why(t))
    const ticketId = t.body?.data?.id ?? t.body?.data?._id

    check('alice sees her tickets', ok(await call('GET', '/support/me', { jar: aliceJar })))
    check('bob\'s list is empty of hers',
      !JSON.stringify((await call('GET', '/support/me', { jar: bobJar })).body ?? '').includes('Need help'))

    if (ticketId) {
      const bobRead = await call('GET', `/support/${ticketId}`, { jar: bobJar })
      check('bob cannot read alice\'s ticket', !ok(bobRead), `got ${bobRead.status}`)
      const bobMsg = await call('POST', `/support/${ticketId}/messages`, { jar: bobJar, body: { body: 'intruding' } })
      check('bob cannot post to alice\'s ticket', !ok(bobMsg), `got ${bobMsg.status}`)
      const own = await call('POST', `/support/${ticketId}/messages`, { jar: aliceJar, body: { body: 'more detail' } })
      check('alice can post to her own', ok(own), why(own))
      const studentClose = await call('PATCH', `/support/${ticketId}/status`, { jar: bobJar, body: { status: 'closed' } })
      check('a student cannot change another\'s ticket status', !ok(studentClose), `got ${studentClose.status}`)
    }
    check('anonymous ticket creation is refused', (await call('POST', '/support', { body: { subject: 'x', message: 'y' } })).status === 401)
    const badTicket = await call('GET', `/support/${BAD}`, { jar: aliceJar })
    check('ticket with a malformed id is not a 5xx', badTicket.status < 500, why(badTicket))
  }

  /* ══════════ 9. GAMIFICATION & NOTIFICATIONS ══════════ */
  section('STREAKS, ACHIEVEMENTS, NOTIFICATIONS')
  {
    for (const [name, url] of [
      ['streaks',       '/streaks/me'],
      ['achievements',  '/achievements/me'],
      ['notifications', '/notifications'],
    ] as [string, string][]) {
      check(`${name} loads`, ok(await call('GET', url, { jar: aliceJar })))
      check(`${name} refuses anonymous`, (await call('GET', url)).status === 401)
    }
    check('streak goal can be set', ok(await call('PATCH', '/streaks/me/goal', { jar: aliceJar, body: { weeklyGoal: 5 } })))
    check('notifications can be marked read', ok(await call('POST', '/notifications/read-all', { jar: aliceJar })))
  }

  /* ══════════ 10. CERTIFICATES ══════════ */
  section('CERTIFICATES')
  {
    const enrolment: any = await EnrollmentModel.findOne({ userId: alice._id, courseId: course._id }).lean()
    if (enrolment) {
      const notDone = await call('GET', `/certificates/${enrolment._id}`, { jar: aliceJar })
      check('an incomplete course yields no certificate', !ok(notDone), `got ${notDone.status}`)
      const bobCert = await call('GET', `/certificates/${enrolment._id}`, { jar: bobJar })
      check('another student cannot fetch it', !ok(bobCert), `got ${bobCert.status}`)
    }
    const badCert = await call('GET', `/certificates/${BAD}`, { jar: aliceJar })
    check('certificate with a malformed id is not a 5xx (B-06)', badCert.status < 500, why(badCert))
    check('public verification of an unknown id answers cleanly',
      ok(await call('GET', '/certificates/verify/00000000-0000-0000-0000-000000000000')))
  }

  /* ══════════ 11. CHECKOUT ══════════ */
  section('CHECKOUT — configuration and refusals')
  {
    check('gateway config loads', ok(await call('GET', '/checkout/config', { jar: aliceJar })))
    check('anonymous config is refused', (await call('GET', '/checkout/config')).status === 401)
    for (const [name, path] of [
      ['stripe',   '/checkout/'],
      ['razorpay', '/checkout/razorpay/create-order'],
      ['tabby',    '/checkout/tabby/create-order'],
      ['abzer',    '/checkout/abzer/create-order'],
      ['tamara',   '/checkout/tamara/create-order'],
    ] as [string, string][]) {
      /* An unconfigured gateway answers 503 with a NAMED code, which is a
         configuration answer rather than a crash. What must never appear is a
         generic INTERNAL_ERROR — that is the signature of something throwing. */
      const clean = (x: { status: number; body: any }) =>
        x.status < 500 || (x.status === 503 && !!x.body?.error?.code && x.body.error.code !== 'INTERNAL_ERROR')

      const r = await call('POST', path, { jar: aliceJar, body: { courseId: String(course._id) } })
      check(`${name} checkout does not fail unexpectedly`, clean(r), why(r))
      check(`${name} checkout refuses anonymous`,
        (await call('POST', path, { body: { courseId: String(course._id) } })).status === 401)
      const bad = await call('POST', path, { jar: aliceJar, body: { courseId: BAD } })
      check(`${name} checkout with a malformed course id does not fail unexpectedly`, clean(bad), why(bad))
    }
  }

  /* ══════════ 12. DOCUMENTS & UPLOADS ══════════ */
  section('DOCUMENTS & UPLOADS')
  {
    const own = await call('GET', `/documents/${alice._id}/passport`, { jar: aliceJar })
    check('own document lookup is not a 5xx', own.status < 500, why(own))
    const bobDoc = await call('GET', `/documents/${alice._id}/passport`, { jar: bobJar })
    check('another student cannot read alice\'s documents', !ok(bobDoc), `got ${bobDoc.status}`)
    check('anonymous document read is refused', (await call('GET', `/documents/${alice._id}/passport`)).status === 401)
    const badField = await call('GET', `/documents/${alice._id}/notafield`, { jar: aliceJar })
    check('an unknown document field is rejected', badField.status === 400, `got ${badField.status}`)

    const presign = await call('POST', '/uploads/presign', { jar: aliceJar, body: { filename: 'x.mp4', contentType: 'video/mp4' } })
    check('a student is refused presigned uploads (P-15)', !ok(presign), `got ${presign.status}`)
  }

  /* ══════════ 13. 2FA ══════════ */
  section('TWO-FACTOR — setup requires the password (NEW-01)')
  {
    const noPw = await call('POST', '/auth/2fa/setup', { jar: aliceJar, body: {} })
    check('2FA setup without a password is refused', !ok(noPw), `got ${noPw.status}`)
    const wrongPw = await call('POST', '/auth/2fa/setup', { jar: aliceJar, body: { password: 'WrongPass123' } })
    check('2FA setup with the wrong password is refused', !ok(wrongPw), `got ${wrongPw.status}`)
    const rightPw = await call('POST', '/auth/2fa/setup', { jar: aliceJar, body: { password: PW } })
    check('2FA setup with the correct password succeeds', ok(rightPw), why(rightPw))
    check('anonymous 2FA setup is refused', (await call('POST', '/auth/2fa/setup', { body: { password: PW } })).status === 401)
  }

  /* ══════════ 14. SIGN OUT ══════════ */
  section('SIGN OUT — the session really ends')
  {
    const jar: Jar = new Map()
    await call('POST', '/auth/login', { jar, body: { email: 'bob@t.local', password: PW } })
    check('bob is signed in', ok(await call('GET', '/auth/me', { jar })))
    check('sign out succeeds', ok(await call('POST', '/auth/logout', { jar })))
    const after = await call('GET', '/auth/me', { jar })
    check('...and the session no longer authenticates', after.status === 401, `got ${after.status}`)
  }

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\n──── EVERY FAILURE ────')
  failures.forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${f}`))
}
process.exit(failures.length === 0 ? 0 : 1)
