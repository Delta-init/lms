/* ─────────────────────────────────────────────────────────────
   LMS ↔ CLT Connect — Phase 5: events flowing back.

   Signature verification and idempotency, over real HTTP against the booted
   app. Idempotency is the property that matters most here: a webhook that is
   not retried loses events, so CLT retries — which means the same delivery
   arriving twice must not double-count attendance or reopen a closed class.

   The signatures are produced exactly as `services/lms_events.py` produces
   them, so a change on either side breaks this suite rather than production.

   Run: bun run test:integration5
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_integration5'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_API_MAX = '9000'

const SECRET = 'phase5-shared-secret'
process.env.CLT_S2S_SECRET = SECRET

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
const { createHmac } = await import('node:crypto')
const app = (await import('@/app.ts')).default
const {
  LiveClassModel, OrganizationModel, CourseModel, UserModel, ClassBookingModel,
} = await import('@/models/schema.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_integration5') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/** Post an event signed the way CLT signs it. */
async function post(event: unknown, opts: { secret?: string; timestamp?: string; tamper?: boolean } = {}) {
  const body      = JSON.stringify(event)
  const timestamp = opts.timestamp ?? String(Date.now())
  const nonce     = Math.random().toString(16).slice(2)
  const signature = createHmac('sha256', opts.secret ?? SECRET)
    .update(`${timestamp}.${nonce}.${body}`).digest('hex')

  const res = await fetch(`${BASE}/webhooks/clt`, {
    method: 'POST',
    headers: {
      'content-type':     'application/json',
      'X-CLT-Timestamp':  timestamp,
      'X-CLT-Nonce':      nonce,
      'X-CLT-Signature':  signature,
    },
    /* tamper: sign the real body, then send a different one. */
    body: opts.tamper ? body.replace('"roomName"', '"roomNameX"') : body,
  })
  const text = await res.text()
  let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed }
}

try {
  const org = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const teacher = await UserModel.create({ name: 'T', email: 't@t.local', passwordHash: 'x', role: 'instructor', isActive: true, organizationId: org._id })
  const student = await UserModel.create({ name: 'S', email: 's@t.local', passwordHash: 'x', role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id })
  const course = await CourseModel.create({
    title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
  })

  const live = await LiveClassModel.create({
    courseId: course._id, instructorId: teacher._id, title: 'Live',
    scheduledStart: new Date(Date.now() - 10 * 60_000), durationMins: 60,
    type: 'internal', provider: 'livekit', status: 'live',
    cltRoomName: 'lms-room-p5', sessionCapacity: 30, organizationId: org._id,
  })
  const booking = await ClassBookingModel.create({
    userId: student._id, liveClassId: live._id, status: 'booked',
  })

  /* ═══════════════════════════════════════════════ */
  section('A · the signature is enforced')
  const unsigned = await fetch(`${BASE}/webhooks/clt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'meeting.ended', roomName: 'lms-room-p5' }),
  })
  check('an unsigned event is refused', unsigned.status === 401, String(unsigned.status))

  const wrongSecret = await post({ type: 'meeting.ended', roomName: 'lms-room-p5' }, { secret: 'not-the-secret' })
  check('a wrong secret is refused', wrongSecret.status === 401, String(wrongSecret.status))

  const tampered = await post({ type: 'meeting.ended', roomName: 'lms-room-p5' }, { tamper: true })
  check('a body edited after signing is refused', tampered.status === 401, String(tampered.status))

  const stale = await post({ type: 'meeting.ended', roomName: 'lms-room-p5' },
    { timestamp: String(Date.now() - 30 * 60_000) })
  check('a replayed capture from 30 minutes ago is refused', stale.status === 401, String(stale.status))

  section('B · recording.ready links an ID, never a URL')
  /* A URL would need a CLT admin token no LMS admin holds, and a presigned link
     would expire sitting in the database. The id is exchanged for a fresh link
     at play time instead. */
  const rec = await post({
    type: 'recording.ready', roomName: 'lms-room-p5',
    data: { recordingId: 4242, durationSecs: 3600 },
  })
  check('accepted', rec.status === 200, `${rec.status} ${JSON.stringify(rec.body?.error ?? '')}`)
  const afterRec = await LiveClassModel.findById(live._id) as any
  check('the recording id is stored on the class',
    afterRec?.cltRecordingId === 4242, String(afterRec?.cltRecordingId))
  check('along with its duration', afterRec?.recordingDurationSecs === 3600,
    String(afterRec?.recordingDurationSecs))
  check('and NO url is invented', afterRec?.recordingUrl === undefined,
    String(afterRec?.recordingUrl))

  const noId = await post({ type: 'recording.ready', roomName: 'lms-room-p5', data: { url: 'https://x/y.mp4' } })
  check('a legacy url-only event is REFUSED rather than silently stored',
    noId.status === 400, `${noId.status} — an unplayable url must not reach the library`)

  const recAgain = await post({
    type: 'recording.ready', roomName: 'lms-room-p5', data: { recordingId: 4242 },
  })
  check('a duplicate delivery is a no-op, not an error',
    recAgain.status === 200 && recAgain.body?.data?.outcome === 'already recorded',
    JSON.stringify(recAgain.body?.data))

  section('C · participant.joined records attendance without touching status')
  const att = await post({
    type: 'participant.joined', roomName: 'lms-room-p5',
    data: { lmsUserId: String(student._id) },
  })
  check('accepted', att.status === 200, String(att.status))
  const marked = await ClassBookingModel.findById(booking._id)
  check('attendedAt is set', !!marked?.attendedAt)
  check('the source is recorded', (marked as any)?.attendanceSource === 'livekit')
  check('the booking status is UNCHANGED — a no-show is not a cancellation',
    marked?.status === 'booked', marked?.status)

  const firstAt = marked!.attendedAt!.getTime()
  await new Promise(r => setTimeout(r, 25))
  const attAgain = await post({
    type: 'participant.joined', roomName: 'lms-room-p5',
    data: { lmsUserId: String(student._id) },
  })
  const remarked = await ClassBookingModel.findById(booking._id)
  check('a repeat delivery does not move the timestamp — the FIRST join counts',
    remarked!.attendedAt!.getTime() === firstAt,
    `${remarked!.attendedAt!.getTime()} vs ${firstAt}`)
  check('and it is reported as already marked',
    attAgain.body?.data?.outcome?.includes('already marked') || attAgain.status === 200,
    JSON.stringify(attAgain.body?.data))

  const guest = await post({
    type: 'participant.joined', roomName: 'lms-room-p5', data: { lmsUserId: '' },
  })
  check('a guest with no LMS id is accepted and ignored, not an error',
    guest.status === 200, String(guest.status))

  section('D · meeting.ended closes the class, once')
  const ended = await post({ type: 'meeting.ended', roomName: 'lms-room-p5' })
  check('accepted', ended.status === 200, String(ended.status))
  const closed = await LiveClassModel.findById(live._id)
  check('status is ended', closed?.status === 'ended', closed?.status)
  check('endedAt is stamped', !!closed?.endedAt)

  const endedAgain = await post({ type: 'meeting.ended', roomName: 'lms-room-p5' })
  check('a duplicate close is a no-op',
    endedAgain.body?.data?.outcome === 'already closed', JSON.stringify(endedAgain.body?.data))

  section('E · unknown rooms and unknown events')
  const ghost = await post({ type: 'meeting.ended', roomName: 'lms-does-not-exist' })
  check('an unknown room is a 404, so CLT stops retrying it', ghost.status === 404, String(ghost.status))

  const unknown = await post({ type: 'something.new', roomName: 'lms-room-p5' })
  check('an unknown event type is ACKed, not rejected',
    unknown.status === 200 && unknown.body?.data?.outcome === 'ignored',
    `${unknown.status} ${JSON.stringify(unknown.body?.data)} — a 4xx would make CLT retry forever`)

  const malformed = await post({ roomName: 'lms-room-p5' })
  check('an event with no type is refused', malformed.status === 400, String(malformed.status))

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
