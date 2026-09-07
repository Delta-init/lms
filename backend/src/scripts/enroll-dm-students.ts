/* ─────────────────────────────────────────────────────────────
   Enroll the bulk-imported Dubai students into the DIGITAL MARKETING
   course and set module-level access from their payment status.

   Access rule (user decision, 2026-09-01) — the sheet's PAYMENT STATUS
   column is the ONLY input:
     PENDING            → first N modules allowed, the rest blocked (N=4)
     FULL PAID / blank  → every module allowed

   `blockedLessons` on an Enrollment stores SECTION (module) ids — the field
   name is a legacy misnomer, and this is exactly what the admin modal writes
   (AddStudentModal builds `new Set(sectionIds)`), so a student configured
   here is indistinguishable from one configured by hand.

   Idempotent: the unique index on (userId, courseId) makes double-enrolment
   impossible, and a second run only corrects access that drifted. Every run
   writes a CSV report to .logs/import-reports/.

   Usage (from backend/):
     bun src/scripts/enroll-dm-students.ts --file=dm-dxb-payments.csv
     bun src/scripts/enroll-dm-students.ts --file=dm-dxb-payments.csv --stage=enroll
     bun src/scripts/enroll-dm-students.ts --file=dm-dxb-payments.csv --stage=verify
   Options: --course="DIGITAL MARKETING"  --allowed=4
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const FILE         = args.get('file')
const STAGE        = args.get('stage') ?? 'dry-run'
const COURSE_TITLE = args.get('course') ?? 'DIGITAL MARKETING'
/* --allowed=half gives PENDING students the first half of the modules, which is
   what the Digital Marketing run did by hand (4 of 8) and what every course
   should follow regardless of how many modules it has. */
const ALLOWED_RAW  = args.get('allowed') ?? '4'
const ALLOWED_HALF = ALLOWED_RAW.toLowerCase() === 'half'
let   ALLOWED      = ALLOWED_HALF ? -1 : Number(ALLOWED_RAW)

if (!FILE) { console.error('❌ --file=<payments csv> is required.'); process.exit(1) }
if (!['dry-run', 'enroll', 'verify'].includes(STAGE)) {
  console.error(`❌ Unknown --stage=${STAGE}. Use enroll | verify (or omit for a dry run).`); process.exit(1)
}
if (!ALLOWED_HALF && (!Number.isInteger(ALLOWED) || ALLOWED < 0)) {
  console.error('❌ --allowed must be a whole number, or the word "half".'); process.exit(1)
}

/* ─── CSV ───────────────────────────────────────────── */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(c => c !== '')) rows.push(row)
  return rows
}

const csv    = parseCsv(readFileSync(FILE, 'utf8'))
const header = csv[0]!.map(h => h.trim())
const cEmail = header.indexOf('EMAIL ID')
const cPay   = header.indexOf('PAYMENT STATUS')
const cName  = header.indexOf('STUDENT NAME')
const cCode  = header.indexOf('STUDENT CODE')
const cPend  = header.indexOf('PENDING AMOUNT')
if (cEmail < 0 || cPay < 0) {
  console.error('❌ CSV must have "EMAIL ID" and "PAYMENT STATUS" columns.'); process.exit(1)
}

interface Row {
  code: string; name: string; email: string; pay: string; pending: string
  restricted: boolean; mismatch: boolean; action: string; reason: string
}
const rows: Row[] = []
const seen = new Set<string>()
for (const r of csv.slice(1)) {
  const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const email = get(cEmail).toLowerCase()
  if (!email) continue
  const pay     = get(cPay).toUpperCase()
  const pending = get(cPend)
  const row: Row = {
    code: get(cCode), name: get(cName), email, pay, pending,
    restricted: pay === 'PENDING',
    /* FULL PAID yet still carrying money owed — reported, never acted on. */
    mismatch: pay === 'FULL PAID' && !!pending && Number(pending) > 0,
    action: 'plan', reason: '',
  }
  if (seen.has(email)) { row.action = 'skip'; row.reason = 'duplicate-in-sheet' } else seen.add(email)
  rows.push(row)
}

/* ─── connect ───────────────────────────────────────── */
const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const dbName = mongoose.connection.db!.databaseName
const { UserModel, CourseModel, SectionModel, EnrollmentModel } = await import('@/models/schema.ts')

console.log('═'.repeat(64))
console.log(`  Stage:    ${STAGE.toUpperCase()}${STAGE === 'dry-run' ? '  (nothing will be written)' : ''}`)
console.log(`  Database: ${dbName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Sheet:    ${FILE}  (${rows.length} students)`)
console.log('═'.repeat(64))

/* ─── resolve the course, unambiguously ─────────────── */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const matches = await CourseModel
  .find({ title: new RegExp(`^\\s*${escapeRe(COURSE_TITLE)}\\s*$`, 'i') })
  .select('_id title').lean()
if (matches.length !== 1) {
  console.error(`\n❌ Expected exactly one course titled "${COURSE_TITLE}", found ${matches.length}.`)
  matches.forEach(m => console.error(`     · ${m.title}  (${String(m._id)})`))
  if (matches.length === 0) {
    const all = await CourseModel.find({}).select('title').sort({ title: 1 }).lean()
    console.error('   Courses in this database:')
    all.forEach(c => console.error(`     · ${c.title}`))
  }
  console.error('   Re-run with --course="<exact title>". Nothing was written.')
  await mongoose.disconnect(); process.exit(1)
}
const course   = matches[0]!
const courseId = course._id

const sections = await SectionModel.find({ courseId })
  .sort({ order: 1, createdAt: 1 }).select('_id title order').lean()
if (sections.length === 0) {
  console.error(`\n❌ Course "${course.title}" has no modules — nothing to block. Aborting.`)
  await mongoose.disconnect(); process.exit(1)
}
if (ALLOWED_HALF) ALLOWED = Math.floor(sections.length / 2)
const blockedIds    = sections.slice(ALLOWED).map(s => s._id)
const blockedKeySet = new Set(blockedIds.map(String))

console.log(`\n  Course:   ${course.title}  (${String(courseId)})`)
console.log(`  Modules:  ${sections.length} — first ${ALLOWED} stay open for PENDING students\n`)
sections.forEach((s, i) => {
  console.log(`     ${String(i + 1).padStart(2)}. ${i < ALLOWED ? 'ALLOWED' : 'BLOCKED'}  ${s.title}`)
})
if (sections.length <= ALLOWED) {
  console.log(`\n  ⚠️  Only ${sections.length} module(s) exist, so nothing is ever blocked.`)
}

/* ─── match students ────────────────────────────────── */
const users = new Map<string, { _id: unknown; organizationId?: unknown }>(
  (await UserModel.find({ email: { $in: rows.map(r => r.email) } })
    .select('email organizationId').lean())
    .map(u => [u.email as string, u as never]),
)
const enrolments = new Map<string, { _id: unknown; blockedLessons?: unknown[] }>(
  (await EnrollmentModel.find({
    courseId,
    userId: { $in: [...users.values()].map(u => u._id) },
  }).select('userId blockedLessons').lean())
    .map(e => [String((e as { userId: unknown }).userId), e as never]),
)

const sameAccess = (current: unknown[] | undefined, want: Set<string>) => {
  const have = new Set((current ?? []).map(String))
  return have.size === want.size && [...want].every(id => have.has(id))
}

for (const r of rows) {
  if (r.action === 'skip') continue
  const user = users.get(r.email)
  if (!user) { r.action = 'skip'; r.reason = 'no LMS account for this email'; continue }
  const want = r.restricted ? blockedKeySet : new Set<string>()
  const enr  = enrolments.get(String(user._id))
  if (!enr)                                      { r.action = 'enroll'; r.reason = r.restricted ? `${blockedIds.length} modules blocked` : 'all modules' }
  else if (sameAccess(enr.blockedLessons, want)) { r.action = 'ok';     r.reason = 'already correct' }
  else                                           { r.action = 'fix';    r.reason = 'access corrected' }
}

/* ─── write ─────────────────────────────────────────── */
if (STAGE === 'enroll') {
  for (const r of rows) {
    if (r.action !== 'enroll' && r.action !== 'fix') continue
    const user = users.get(r.email)!
    const want = r.restricted ? blockedIds : []
    try {
      if (r.action === 'enroll') {
        await EnrollmentModel.create({
          userId:         user._id,
          courseId,
          blockedLessons: want,
          source:         'script',
          ...(user.organizationId ? { organizationId: user.organizationId } : {}),
        })
        r.action = 'enrolled'
      } else {
        await EnrollmentModel.updateOne(
          { userId: user._id, courseId },
          { $set: { blockedLessons: want } },
        )
        r.action = 'fixed'
      }
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      if (e.code === 11000) {
        /* Someone enrolled them between the read and the write — correct the
           access on the row that won rather than losing the student. */
        await EnrollmentModel.updateOne({ userId: user._id, courseId }, { $set: { blockedLessons: want } })
        r.action = 'fixed'; r.reason = 'raced, access applied'
      } else {
        r.action = 'error'; r.reason = String(e.message).slice(0, 90)
      }
    }
  }
}

if (STAGE === 'verify') {
  const userIds = [...users.values()].map(u => u._id)
  const live = await EnrollmentModel.find({ courseId, userId: { $in: userIds } })
    .select('userId blockedLessons').lean()
  const byUser = new Map(live.map(e => [String((e as { userId: unknown }).userId), e]))
  let full = 0, limited = 0, wrong = 0, missing = 0
  for (const r of rows) {
    const user = users.get(r.email)
    if (!user) continue
    const e = byUser.get(String(user._id))
    if (!e) { missing++; r.action = 'MISSING'; r.reason = 'not enrolled'; continue }
    const want = r.restricted ? blockedKeySet : new Set<string>()
    if (!sameAccess((e as { blockedLessons?: unknown[] }).blockedLessons, want)) {
      wrong++; r.action = 'WRONG'; r.reason = 'access does not match the sheet'
    } else if (r.restricted) { limited++; r.action = 'ok'; r.reason = `${blockedIds.length} blocked` }
    else { full++; r.action = 'ok'; r.reason = 'all modules' }
  }
  console.log('\n  Verification against the database:')
  console.log(`    enrolled, full access      : ${full}`)
  console.log(`    enrolled, first ${ALLOWED} modules : ${limited}`)
  console.log(`    access mismatch            : ${wrong}`)
  console.log(`    not enrolled               : ${missing}`)
  console.log(`    ${wrong === 0 && missing === 0 ? '✅ everything matches the sheet' : '⚠️  re-run --stage=enroll to fix'}`)
}

/* ─── report ────────────────────────────────────────── */
const summary = new Map<string, number>()
for (const r of rows) {
  const key = `${r.action}${r.reason ? ` — ${r.reason}` : ''}`
  summary.set(key, (summary.get(key) ?? 0) + 1)
}
console.log('\n  Result:')
for (const [k, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(5)}  ${k}`)
}
const mismatches = rows.filter(r => r.mismatch)
if (mismatches.length) {
  console.log(`\n  Note: ${mismatches.length} student(s) marked FULL PAID still show a pending amount.`)
  console.log('        Per your instruction they get full access — listed in the report as mismatch=yes.')
}

const dir = join(process.cwd(), '.logs', 'import-reports')
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const path  = join(dir, `enroll-${STAGE}-${stamp}.csv`)
const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
writeFileSync(path, [
  'studentCode,name,email,paymentStatus,pendingAmount,access,mismatch,action,reason',
  ...rows.map(r => [
    r.code, r.name, r.email, r.pay, r.pending,
    r.restricted ? `first ${ALLOWED} modules` : 'all modules',
    r.mismatch ? 'yes' : '', r.action, r.reason,
  ].map(v => esc(String(v ?? ''))).join(',')),
].join('\n'), 'utf8')
console.log(`\n  Report: ${path}`)
if (STAGE === 'dry-run') console.log('  Nothing was written. Next: --stage=enroll\n')

await mongoose.disconnect()
process.exit(0)
