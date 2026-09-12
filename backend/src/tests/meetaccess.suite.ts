/* ─────────────────────────────────────────────────────────────
   Opening the Google Meet room.

   A Meet attached to a Calendar event inherits the host's default access,
   TRUSTED: people inside the host's Workspace domain walk in, everyone else
   knocks. This app invites nobody as a calendar attendee — it emails a link —
   so every student was in the "everyone else" bucket. Setting the space to
   OPEN removes the knock.

   The patch itself belongs to Google, and this suite never calls it: creating
   real meetings to assert on would leave litter in a live Workspace calendar
   and would fail on any machine without credentials. What IS ours, and what
   breaks quietly if it regresses, is:

     · which access type the environment asks for, including the refusal to
       guess at a value nobody recognises;
     · that a failure to set it NEVER takes the class down with it. Access is
       a nicety; a class that cannot be created is an outage. That ordering is
       the whole reason the call is wrapped, so it is asserted directly.

   Run: bun run test:meetaccess
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

/* The module reads the env at CALL time, not at import time, so each case can
   set a value and re-ask without reloading anything. */
const { setMeetAccessType } = await import('@/services/googleMeet.service.ts')

/* A stand-in for the googleapis client. Records what it was asked to do and
   answers however the case needs — which is the only way to assert the
   non-fatal contract without a live Google account. */
function fakeAuth(): any { return { __fake: true } }

const { google } = await import('googleapis')
const realMeet = google.meet
let lastPatch: any = null

function stubMeet(behaviour: 'ok' | 'forbidden' | 'boom') {
  lastPatch = null
  ;(google as any).meet = () => ({
    spaces: {
      patch: async (args: any) => {
        lastPatch = args
        if (behaviour === 'forbidden') {
          throw Object.assign(new Error('Request had insufficient authentication scopes.'),
            { response: { status: 403, data: { error: { message: 'insufficient scopes' } } } })
        }
        if (behaviour === 'boom') throw new Error('socket hang up')
        return { data: {} }
      },
    },
  })
}
function restoreMeet() { (google as any).meet = realMeet }

try {
  /* ═══════════════════════════════════════════════ */
  section('A · what the environment asks for')
  {
    stubMeet('ok')

    delete process.env['GOOGLE_MEET_ACCESS_TYPE']
    check('with nothing set, the room is OPENed — the new default',
      await setMeetAccessType('abc-defg-hij', fakeAuth()) === 'OPEN')
    check('and it patched the space by MEETING CODE',
      lastPatch?.name === 'spaces/abc-defg-hij', String(lastPatch?.name))
    check('touching only the access field',
      lastPatch?.updateMask === 'config.accessType', String(lastPatch?.updateMask))
    check('with the value Google expects',
      lastPatch?.requestBody?.config?.accessType === 'OPEN',
      JSON.stringify(lastPatch?.requestBody))

    process.env['GOOGLE_MEET_ACCESS_TYPE'] = 'TRUSTED'
    check('TRUSTED puts the knock back, without a code change',
      await setMeetAccessType('abc-defg-hij', fakeAuth()) === 'TRUSTED')

    process.env['GOOGLE_MEET_ACCESS_TYPE'] = 'restricted'
    check('the value is case-insensitive',
      await setMeetAccessType('abc-defg-hij', fakeAuth()) === 'RESTRICTED')

    process.env['GOOGLE_MEET_ACCESS_TYPE'] = '  OPEN  '
    check('and tolerant of stray whitespace',
      await setMeetAccessType('abc-defg-hij', fakeAuth()) === 'OPEN')

    /* An off switch that does not require choosing a wrong value. */
    for (const off of ['OFF', 'NONE', '']) {
      process.env['GOOGLE_MEET_ACCESS_TYPE'] = off
      const r = await setMeetAccessType('abc-defg-hij', fakeAuth())
      check(`"${off || '(empty)'}" leaves the meeting exactly as Google made it`, r === null, String(r))
    }
    process.env['GOOGLE_MEET_ACCESS_TYPE'] = 'OFF'
    lastPatch = null
    await setMeetAccessType('abc-defg-hij', fakeAuth())
    check('and issues no call at all when switched off', lastPatch === null)

    /* A typo must not silently become RESTRICTED and lock everyone out. */
    process.env['GOOGLE_MEET_ACCESS_TYPE'] = 'OPENN'
    check('an unrecognised value falls back to OPEN rather than being guessed at',
      await setMeetAccessType('abc-defg-hij', fakeAuth()) === 'OPEN')

    delete process.env['GOOGLE_MEET_ACCESS_TYPE']
  }

  /* ═══════════════════════════════════════════════ */
  section('B · a failure here must never take the class down')
  {
    /* The likely one: the refresh token predates the scope. */
    stubMeet('forbidden')
    let threw = false
    let out: unknown = 'unset'
    try { out = await setMeetAccessType('abc-defg-hij', fakeAuth()) } catch { threw = true }
    check('a 403 does not throw', !threw)
    check('it reports that nothing was applied', out === null, String(out))

    /* And anything else — a network blip, Google having a bad day. */
    stubMeet('boom')
    threw = false
    try { out = await setMeetAccessType('abc-defg-hij', fakeAuth()) } catch { threw = true }
    check('nor does an unexpected error', !threw)
    check('same answer: nothing applied', out === null, String(out))

    /* A meeting with no code cannot be addressed, and must not be attempted. */
    stubMeet('ok')
    lastPatch = null
    check('an empty meeting code is a no-op', await setMeetAccessType('', fakeAuth()) === null)
    check('and issues no call', lastPatch === null)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · the scope the whole thing depends on')
  {
    /* Instructor-hosted classes are created through domain-wide delegation,
       and a JWT only carries the scopes listed against the service account.
       Drop the Meet scope from this list and nothing breaks loudly: events
       still get created, links still work, and every room quietly stays shut
       while the logs fill with 403s nobody reads.

       Asserted on the source because there is no runtime signal for it. */
    const { readFile } = await import('node:fs/promises')
    const nodePath = (await import('node:path')).default
    const src = await readFile(
      nodePath.join(process.cwd(), 'src', 'services', 'googleMeet.service.ts'), 'utf8')

    /* Read out of the scopes ARRAY, not the file.

       A mutation run caught the lazy version of this: searching the whole file
       for the scope string passed even with the scope deleted from the array,
       because the same URL appears in the 403 warning message a few lines
       below. The test was matching its own error text. */
    const scopesBlock = /scopes:\s*\[([\s\S]*?)\]/.exec(src)?.[1] ?? ''
    check('a scopes array was found to read', scopesBlock.length > 0)
    check('and it requests meetings.space.settings',
      scopesBlock.includes('https://www.googleapis.com/auth/meetings.space.settings'),
      scopesBlock.replace(/\s+/g, ' ').slice(0, 120))
    check('alongside the calendar scopes it always needed',
      scopesBlock.includes('https://www.googleapis.com/auth/calendar')
      && scopesBlock.includes('https://www.googleapis.com/auth/calendar.events'))

    /* The patch must name the field it changes. A missing updateMask makes
       Google replace the whole config, silently clearing anything else set
       on the space. */
    check('the patch is scoped with an updateMask',
      src.includes("updateMask: 'config.accessType'"))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  restoreMeet()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
