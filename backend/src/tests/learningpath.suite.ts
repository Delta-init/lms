/* ─────────────────────────────────────────────────────────────
   Learning-path tenancy + ownership suite (P-22).

   Runs against an ISOLATED throwaway database (lms_lp_suite) on the same
   local mongod, dropped on exit. The real `lms` database is never opened.

   P-22 was two holes: PATCH was open to every instructor on the platform and
   DELETE to every admin (no owner check), and the model carried no academy at
   all. Ownership was closed first; this suite covers both halves.

   Run: bun run test:paths
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_lp_suite'
process.env.NODE_ENV     = 'test'

/* This file reaches its dependencies through dynamic import() so that the env
   above is set before any module reads it. That leaves no static import or
   export, which makes TypeScript treat it as a script rather than a module and
   reject top-level await — bun runs it either way, but `tsc --noEmit` fails.
   An empty export restores module status without changing behaviour. */
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'ok' }
  catch (e: any) { return e?.code ?? `UNEXPECTED:${e?.message}` }
}
async function expectCode(label: string, fn: () => Promise<unknown>, want: string) {
  const got = await codeOf(fn)
  check(label, got === want, `got ${got}, want ${want}`)
}

const mongoose = (await import('mongoose')).default

/* autoIndex off: mongoose builds indexes asynchronously, and those builds
   race the dropDatabase() in the finally below — recreating empty collection
   shells after the teardown and leaving a stray database behind. Nothing here
   depends on index behaviour. */
mongoose.set('autoIndex', false)
const { LearningPathModel } = await import('@/models/schema.ts')
const { LearningPathService } = await import('@/services/learningpath.service.ts')
const svc = new LearningPathService()

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_lp_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const oid = () => new mongoose.Types.ObjectId().toString()
const DUBAI = oid(), BLR = oid()
const alice = oid(), bob = oid(), dubaiAdmin = oid(), blrAdmin = oid(), superA = oid()

try {
  /* Alice authors a Dubai path. */
  const p = await svc.adminCreate(alice, { title: `Dubai Path ${Date.now()}` }, DUBAI)
  const id = String(p._id)
  check('A1  create stamps the owning academy',
    String((p as any).organizationId) === DUBAI, String((p as any).organizationId))

  /* ── Ownership: instructors are confined to their own paths ── */
  await expectCode('B1  a DIFFERENT instructor cannot edit it',
    () => svc.adminUpdate(id, { title: 'hijacked' }, { id: bob, role: 'instructor', organizationId: DUBAI }),
    'PATH_NOT_FOUND')
  await expectCode('B2  the author can edit it',
    () => svc.adminUpdate(id, { title: 'renamed by author' }, { id: alice, role: 'instructor', organizationId: DUBAI }),
    'ok')

  /* ── Tenancy: the other academy cannot reach it at all ── */
  await expectCode('C1  the OTHER academy\'s admin cannot edit it',
    () => svc.adminUpdate(id, { title: 'cross-tenant' }, { id: blrAdmin, role: 'admin', organizationId: BLR }),
    'PATH_NOT_FOUND')
  await expectCode('C2  the OTHER academy\'s admin cannot delete it',
    () => svc.adminDelete(id, { id: blrAdmin, role: 'admin', organizationId: BLR }),
    'PATH_NOT_FOUND')
  check('C3  the path still exists after those attempts', !!(await LearningPathModel.findById(id)))
  await expectCode('C4  its OWN academy\'s admin can edit it',
    () => svc.adminUpdate(id, { title: 'renamed by own admin' }, { id: dubaiAdmin, role: 'admin', organizationId: DUBAI }),
    'ok')
  await expectCode('C5  super_admin is never academy-scoped',
    () => svc.adminUpdate(id, { title: 'renamed by super' }, { id: superA, role: 'super_admin', organizationId: BLR }),
    'ok')

  /* ── Listing is scoped ── */
  await svc.adminCreate(blrAdmin, { title: `Bangalore Path ${Date.now()}` }, BLR)
  const dubaiList = await svc.adminList({ organizationId: DUBAI })
  const blrList   = await svc.adminList({ organizationId: BLR })
  check('D1  Dubai admin list shows only Dubai paths',
    dubaiList.paths.length === 1 && String((dubaiList.paths[0] as any).organizationId) === DUBAI,
    `saw ${dubaiList.paths.length}`)
  check('D2  Bangalore admin list shows only Bangalore paths',
    blrList.paths.length === 1 && String((blrList.paths[0] as any).organizationId) === BLR,
    `saw ${blrList.paths.length}`)
  check('D3  an unscoped caller still sees both',
    (await svc.adminList({})).paths.length === 2)

  /* ── Legacy rows (no academy) stay reachable ── */
  const legacy = await LearningPathModel.create({
    title: 'Legacy Path', slug: `legacy-${Date.now()}`, instructorId: alice, status: 'published',
  })
  const legacyId = String(legacy._id)
  check('E1  a legacy row really has no academy',
    (legacy as any).organizationId === undefined)
  await expectCode('E2  either academy can still edit a legacy row',
    () => svc.adminUpdate(legacyId, { title: 'legacy touched' }, { id: blrAdmin, role: 'admin', organizationId: BLR }),
    'ok')
  check('E3  legacy rows appear in a scoped list',
    (await svc.adminList({ organizationId: DUBAI })).paths.length === 2)

  /* ── Published listing is scoped the same way ──
     Every later step is wrapped: if a tenancy gate above regresses, phase C's
     cross-academy DELETE genuinely succeeds and the path is gone. The suite
     must still report which checks failed rather than dying on a bare await. */
  await codeOf(() => svc.adminUpdate(id, { status: 'published' }, { id: superA, role: 'super_admin' }))
  const pubDubai = await svc.listPublished({ organizationId: DUBAI })
  check('F1  published list is academy-scoped',
    pubDubai.paths.every(x => {
      const o = (x as any).organizationId
      return !o || String(o) === DUBAI
    }), `saw ${pubDubai.paths.length}`)
  check('F2  anonymous (no academy) sees the full catalogue',
    (await svc.listPublished({})).paths.length >= pubDubai.paths.length)

  /* ── Delete, correctly scoped ── */
  await expectCode('G1  own-academy admin can delete',
    () => svc.adminDelete(id, { id: dubaiAdmin, role: 'admin', organizationId: DUBAI }), 'ok')
  check('G2  it is gone', !(await LearningPathModel.findById(id)))

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
