/* ─────────────────────────────────────────────────────────────
   Convert ONE express account into a full registered account, filling in the
   enrolment application and attaching identity documents on the student's
   behalf.

   Why this exists: the portal's own "complete registration" flow is the normal
   path, but it needs the student to log in and upload their own files. When
   the academy already holds the documents, this does the same job admin-side.
   The admin UI cannot: it shows identity documents read-only (KycThumb has no
   upload) and express accounts live in a separate tab with no approve action.

   Documents go through exactly the same pipeline as the signup form:
   makeKey(..., 'kyc') + uploadKycFile(), so the value stored is a private
   `kyc/<key>` reference, never a public URL. It is readable only through
   GET /documents/:userId/:field, which issues a five-minute signed link.
   Magic bytes are checked here too, because bypassing HTTP must not bypass
   the guarantee that a file is what it claims to be.

   What it does NOT do: approve the student or assign a programme. Once the
   account is 'full' it appears in the admin's enrolment requests, where a
   human can approve it and the badge records who did — a better audit trail
   than a script stamping itself.

   Report-only by default; --apply performs the change.

   Usage (from backend/):
     bun src/scripts/convert-express-to-full.ts --email=someone@example.com \
       --passport="C:/path/passport.jpg" --id-doc="C:/path/emirates-id.jpg" \
       --phone=971504955895 --dob=1974-01-08 --gender=Male \
       --nationality=Indian --home-country=India \
       --emirates-id=784-1974-5828538-0 --passport-no=AI852152 \
       --villa="Flat 202 bldg 3885, Muweilah Commercial" --city=Sharjah \
       --address-country=UAE --country-attendance=UAE
     …then re-run with --apply
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import { readFileSync, existsSync } from 'node:fs'
import { extname, basename } from 'node:path'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const EMAIL = (args.get('email') ?? '').trim().toLowerCase()
const APPLY = args.has('apply')
if (!EMAIL) { console.error('❌ --email=<student email> is required.'); process.exit(1) }

/* Which enrolment-application fields a flag maps to. Only flags actually
   passed are written, so a re-run never blanks a field by omission. */
const FIELD_FLAGS: Record<string, string> = {
  'phone':             'phone',
  'emergency-contact': 'emergencyContact',
  'gender':            'gender',
  'dob':               'dateOfBirth',
  'nationality':       'nationality',
  'home-country':      'homeCountry',
  'occupation':        'occupation',
  'id-type':           'idType',
  'passport-no':       'idNumber',
  'emirates-id':       'emiratesId',
  'country-attendance':'countryAttendance',
  'villa':             'villa',
  'city':              'city',
  'address-country':   'addressCountry',
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.pdf': 'application/pdf',
}

interface Doc { flag: string; field: 'passportUrl' | 'idDocUrl' | 'photoUrl'; path: string; mime: string; bytes: Buffer }
const docs: Doc[] = []
for (const [flag, field] of [['passport', 'passportUrl'], ['id-doc', 'idDocUrl'], ['photo', 'photoUrl']] as const) {
  const p = args.get(flag)
  if (!p) continue
  if (!existsSync(p)) { console.error(`❌ --${flag}: file not found — ${p}`); process.exit(1) }
  const ext  = extname(p).toLowerCase()
  const mime = MIME[ext]
  if (!mime) { console.error(`❌ --${flag}: unsupported file type "${ext}". Use jpg, png, webp or pdf.`); process.exit(1) }
  if (field === 'photoUrl' && mime === 'application/pdf') { console.error('❌ --photo must be an image, not a PDF.'); process.exit(1) }
  docs.push({ flag, field, path: p, mime, bytes: readFileSync(p) })
}

const { verifyFileSignature } = await import('@/middleware/upload.middleware.ts')
for (const d of docs) {
  if (!verifyFileSignature(d.bytes, d.mime)) {
    console.error(`❌ --${d.flag}: the file contents do not match a ${d.mime}. Refusing to upload it.`)
    process.exit(1)
  }
  const mb = d.bytes.length / (1024 * 1024)
  if (mb > 5) { console.error(`❌ --${d.flag}: ${mb.toFixed(1)} MB is too large (limit 5 MB).`); process.exit(1) }
}

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const dbName = mongoose.connection.db!.databaseName
const { UserModel } = await import('@/models/schema.ts')

console.log('═'.repeat(64))
console.log(`  Mode:     ${APPLY ? 'APPLY' : 'REPORT ONLY'}`)
console.log(`  Database: ${dbName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Student:  ${EMAIL}`)
console.log('═'.repeat(64))

const user = await UserModel.findOne({ email: EMAIL })
  .select('name email role signupType enrollmentStatus categories category organizationId enrollmentApplication fullRegistrationSubmittedAt').lean()
if (!user) {
  console.error(`\n❌ No account found for ${EMAIL}. Nothing was changed.`)
  await mongoose.disconnect(); process.exit(1)
}
const app = (user as { enrollmentApplication?: Record<string, unknown> }).enrollmentApplication ?? {}

console.log('\n  BEFORE')
console.log(`    name              : ${user.name}`)
console.log(`    role              : ${user.role}`)
console.log(`    signupType        : ${(user as { signupType?: string }).signupType ?? '(unset)'}`)
console.log(`    enrollmentStatus  : ${(user as { enrollmentStatus?: string }).enrollmentStatus ?? '(unset)'}`)
console.log(`    categories        : ${((user as { categories?: string[] }).categories ?? []).join(' + ') || '(none)'}`)
console.log(`    application fields: ${Object.keys(app).length ? Object.keys(app).join(', ') : '(empty)'}`)

/* ── build the update ── */
const set: Record<string, unknown> = {}
const planned: string[] = []
for (const [flag, field] of Object.entries(FIELD_FLAGS)) {
  const v = args.get(flag)
  if (v === undefined) continue
  set[`enrollmentApplication.${field}`] = v
  planned.push(`${field} = ${v}`)
}
if (args.get('name')) { set['name'] = args.get('name'); planned.push(`name = ${args.get('name')}`) }
/* An Emirates ID was supplied but no explicit type — label it, so the admin
   panel shows what the ID document actually is. */
if (args.get('emirates-id') && !args.get('id-type')) {
  set['enrollmentApplication.idType'] = 'Emirates ID'
  planned.push('idType = Emirates ID')
}
set['signupType'] = 'full'
set['fullRegistrationSubmittedAt'] = new Date()
planned.push("signupType = full  (moves them out of Express Members)")

console.log('\n  WILL SET')
for (const p of planned) console.log(`    ${p}`)
console.log('\n  DOCUMENTS')
if (docs.length === 0) console.log('    (none supplied)')
for (const d of docs) {
  console.log(`    ${d.field.padEnd(12)} ${basename(d.path)}  ${(d.bytes.length / 1024).toFixed(0)} KB  ${d.mime}`)
}

if (!APPLY) {
  console.log('\n  Nothing changed. Re-run with --apply to make the change.\n')
  await mongoose.disconnect(); process.exit(0)
}

/* ── upload documents exactly as the signup form does ── */
if (docs.length > 0) {
  const { makeKey, uploadKycFile, uploadFile, isR2Configured } = await import('@/services/r2.service.ts')
  const { safeUploadName } = await import('@/middleware/upload.middleware.ts')
  console.log(`\n  Uploading to ${isR2Configured() ? 'R2' : 'local disk (R2 not configured)'}…`)
  for (const d of docs) {
    if (d.field === 'photoUrl') {
      /* The avatar is deliberately public — it renders as an <img> in dozens
         of places and cannot go behind a signed link. */
      const key = makeKey(safeUploadName(d.mime), 'documents')
      const url = await uploadFile(d.bytes, key, d.mime)
      set['enrollmentApplication.photoUrl'] = url
      console.log(`    photoUrl     -> ${url}`)
    } else {
      const key    = makeKey(safeUploadName(d.mime), 'kyc')
      const stored = await uploadKycFile(d.bytes, key, d.mime)
      set[`enrollmentApplication.${d.field}`] = stored
      console.log(`    ${d.field.padEnd(12)} -> ${stored}  (private)`)
    }
  }
}

await UserModel.updateOne({ _id: user._id }, { $set: set })

const after = await UserModel.findById(user._id)
  .select('name signupType enrollmentStatus enrollmentApplication fullRegistrationSubmittedAt').lean()
const afterApp = (after as { enrollmentApplication?: Record<string, unknown> })?.enrollmentApplication ?? {}
console.log('\n  AFTER')
console.log(`    name              : ${after?.name}`)
console.log(`    signupType        : ${(after as { signupType?: string })?.signupType}`)
console.log(`    enrollmentStatus  : ${(after as { enrollmentStatus?: string })?.enrollmentStatus ?? '(unset)'}`)
console.log('    application:')
for (const [k, v] of Object.entries(afterApp)) {
  const shown = typeof v === 'string' && v.startsWith('kyc/') ? `${v}  (private, signed link only)` : String(v)
  console.log(`      ${k.padEnd(20)} ${shown}`)
}
console.log('\n  Done. The student now appears in the admin Students / enrolment-requests list,')
console.log('  where an admin can approve them and assign their programme.\n')

await mongoose.disconnect()
process.exit(0)
