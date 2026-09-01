# Plan — move the classroom out of the LMS and into CLT Connect

Status: **proposal, not started**
Author: drafted 2026-08-29
Supersedes the embedded-room half of `docs/CLT_INTEGRATION.md` (Phases 3–4). The
identity, command and event planes stay exactly as they are.

---

## 0. The premise, checked first

The stated reason for this change is that students attending inside the LMS
"creates traffic on the LMS". **Media never touches the LMS today.**

```
browser ──ticket──▶ LMS            (2 small JSON calls, ~1 KB)
browser ──ticket──▶ CLT            (1 call, returns a LiveKit token)
browser ◀══media══▶ LiveKit SFU    (all audio/video, direct, port 7880)
```

`LiveKitRoom serverUrl={session.ws_url}` points at the SFU, not at us. A 30‑seat
class costs the LMS **two requests per student per join**.

What the LMS *does* serve today is the page around the room:

| Source | Rate |
|---|---|
| `/live-classes/:id/watch` page render | once per join |
| that page's poll of the same endpoint | 1 req / 20 s / student |
| notifications unread-count poll | 1 req / 30 s / student |

At 30 students that is roughly **2.5 req/s** — not a load problem, and the polls
would remain on any LMS page the student sits on anyway.

**So this change should be chosen for product reasons, not performance ones.**
The good reasons are real:

- one classroom UI to build and improve, instead of two front-ends drifting apart
- CLT's existing lobby, chat, hand-raise, recording controls come for free
- `livekit-client` and `@livekit/components-react` leave both LMS bundles
- a future mobile app hits one meeting surface

The costs are also real, and §5 lists them. The forensic watermark is the one
that matters most.

---

## 1. Feasibility

**Yes, and it is smaller than it looks**, because CLT already has the classroom.

Already built and reusable:

| Piece | Where |
|---|---|
| Room UI, chat, controls | `frontend/src/pages/meeting/Classroom.jsx` (`/meeting/:roomName`) |
| Lobby / admission | `frontend/src/pages/meeting/Lobby.jsx` |
| Ticket verification (EdDSA + JWKS + single-use `jti`) | `backend/app/services/lms_tickets.py` |
| Token minting per role | `backend/app/services/livekit_tokens.py` |
| Room creation on instructor entry | `backend/app/api/lms.py` |

And one detail makes the handoff almost free:

```js
// Classroom.jsx
const stored = safeSession.getItem(`lk-${roomName}`)
if (stored) { setConnection(JSON.parse(stored)); return }
```

The classroom will run from a connection object placed in `sessionStorage`. A
handoff route that redeems a ticket and writes that key can then `navigate()`
straight into the **existing** room with no changes to `Classroom.jsx`.

What genuinely has to be built is **identity handoff**, not a classroom.

---

## 2. The one hard problem: getting the ticket across safely

Today the ticket is POSTed in a request body, deliberately — it is a bearer
credential and a URL would put it in browser history, the `Referer` header,
proxy logs and any screen-share of the address bar.

A redirect appears to force it into the URL. It does not.

### Chosen design — opaque one-time code, exchanged server-to-server

```
1. student clicks Join
2. LMS mints the ticket as it does now, stores it under a random 32-byte code
   (Mongo, TTL 120 s, single-use)
3. LMS 302s to  https://meet.delta…/lms/enter?c=<code>
4. CLT frontend POSTs the code to CLT  /api/lms/enter
5. CLT backend calls back to the LMS over the EXISTING HMAC S2S channel:
   GET /api/v1/integrations/handoff/<code>   → the signed ticket, code burned
6. CLT verifies the ticket exactly as today, mints the LiveKit token
7. CLT writes  sessionStorage['lk-<room>']  and navigates to /meeting/<room>
```

Why this shape:

- **nothing sensitive is ever in a URL** — the code is meaningless without the
  HMAC secret, and dies after one use or 120 seconds
- **reuses the S2S channel** already built and tested; no shared Redis between
  the two systems, no new trust relationship
- **the ticket contract does not change**, so `lms_tickets.py` is untouched
- a leaked code in someone's history is worthless the moment it is redeemed

Rejected alternatives:

| Option | Why not |
|---|---|
| Ticket directly in the query string | Bearer credential in history, logs, `Referer`. 90 s TTL narrows but does not close it. |
| Auto-submitting cross-origin POST form | Keeps it out of the URL, but adds a form-POST surface on CLT and interacts badly with `SameSite` and popup blockers. |
| Shared Redis between LMS and CLT | Couples two deployments at the datastore. The S2S channel already exists for exactly this kind of call. |

---

## 3. Authority must not move

The rule from the original integration stands: **the LMS decides who may enter
and with what powers; CLT honours that decision.** Nothing in this change may
weaken it.

One requested feature bumps into this. Item 5 of the request asks that an admin
choose *host* or *hidden* **on the meeting application**. If CLT decided that,
CLT would be inventing authority.

**Resolution:** the ticket gains one capability flag.

```jsonc
"grants": {
  "canPublish": false,
  "roomAdmin":  false,
  "bypassLobby": true,
  "hidden":      true,
  "mayUnhide":   true      // NEW — the LMS permits this person to reveal themselves
}
```

CLT may then offer the toggle, but only because the LMS said it could, and only
within the ceiling the LMS set. `mayUnhide` is true for admin observers and
false for everyone else — an instructor is never hidden, a student never
unhides.

This also fixes an existing wart: today the choice is two buttons *before*
joining, so an admin who wants to speak must leave and re-enter.

---

## 3b. Identity: reuse CLT's roles, do not invent new ones

CLT already ships the roles and the features this change wants:

```
super_admin · admin · mentor · customer_service · customer_service_head
             + display_role (master_of_academics, senior_mentor)
recordings list/stream/export · audit log · lobby · screen recording
```

So nothing is rebuilt. Two populations, handled differently.

### Staff — JIT-provisioned CLT accounts

CLT's recordings and admin endpoints gate on `CurrentUser` (a real `User` row),
so staff need accounts. Provision on first redirect, keyed by the LMS user id,
and re-sync role + name + avatar from the ticket on **every** entry so the LMS
stays the source of truth.

**Mapping — implemented in `backend/app/core/lms_roles.py` (CLT):**

| LMS role | CLT tier | CLT display_role | Note |
|---|---|---|---|
| `super_admin` | `super_admin` | `super_admin` | exact equivalent |
| `admin` | `admin` | `master_of_academics` | CLT's admin-tier label |
| `instructor` | `mentor` | `senior_mentor` (`trading_mentor` if programme = forex) | host of their own class |
| `support` | `customer_service` | `customer_service` | exact equivalent |
| `sub_admin` | **`user`** | `lms_sub_admin` | programme-scoped — see below |
| `4x_admin` | **`user`** | `lms_4x_admin` | programme-scoped |
| `digital_marketing_admin` | **`user`** | `lms_dm_admin` | programme-scoped |
| `ai_admin` | **`user`** | `lms_ai_admin` | programme-scoped |
| `student` | — none — | — | ephemeral, see below |

No new **tier** was invented — a tier drives every `require_*` dependency in
CLT, so adding one would mean auditing every permission check. Only labels were
added, and only where CLT had no honest equivalent. The four `lms_*` labels are
registered in `DISPLAY_ROLE_TIERS` (so `tier_for()` resolves them) but kept out
of `schemas.user.DisplayRole` (so a CLT operator cannot hand-assign a
federated-looking role the LMS never authorised).

⚠️ **Why the four scoped roles are `user`, not `admin`.** A ticket grants power
over one room; a CLT tier grants power over the platform. Those four LMS roles
are programme-scoped — `assertAdminMayObserve` refuses a digital-marketing
sub-admin entry to a JURA class — and **CLT has no equivalent scoping**. Giving
them CLT `admin` would let them walk around that wall through the other door.

As `user` they still join classes normally through the room-scoped ticket, with
the LMS's programme and academy rules applied. What they lose is CLT's
recordings *list*. That is the deliberate cost of not widening authority, and
`SCOPED_ADMIN_TIER` is a one-line flip if the trade ever changes — guarded by a
test that fails loudly when it does.

An LMS role added to the schema and not decided here raises at the handoff
rather than defaulting to a tier, because a silent default is how someone ends
up with more power than anyone chose to give them.

### Students — no CLT account, ever

Ticket → token → room, exactly as today. No `User` row, no CLT login, access
dies with the ticket. Thousands of student accounts would be a needless surface
and a sync burden, and students need none of CLT's account features.

### What this removes from the plan

CLT's **lobby** already does camera/mic permission, device selection and
admission. It replaces both the LMS join button and the "waiting for the
instructor" state — so Phase 2's error handling shrinks, and the LMS-side
waiting UI can eventually be deleted.

CLT's **recordings** already list, stream and export. The LMS admin recordings
work noted as outstanding elsewhere becomes a link, not a build.

---

## 3c. Profile photo when the camera is off

Requested: show the participant's LMS profile photo in place of the grey
silhouette.

```
ticket gains  avatarUrl
  → CLT writes it into the LiveKit token's participant metadata
  → the tile renders the photo when no video track is published
```

LiveKit metadata is set at token-mint time, which CLT already controls, so this
needs no new transport. Two caveats worth recording:

- participant metadata is **broadcast to everyone in the room**, so each
  avatar URL is visible to the other participants. Harmless — they can see the
  photo regardless — but it does leave the LMS's audience.
- LMS avatars are served from `/uploads/images/:file` **without auth** (random
  hex filenames), so CLT can load them directly. If avatars ever move behind
  authentication this must become a signed or proxied URL.

Work: one field on the ticket, one line at mint time, one change to CLT's
participant tile.

---

## 4. Phases

Each phase leaves the system working. The embed stays behind a flag until the
last phase, so rollback is one env var.

### Phase 1 — handoff transport (LMS + CLT, no UI change)

- LMS: `HandoffCode` model — `{ code, ticket, expiresAt, usedAt }`, TTL index
- LMS: `GET /api/v1/integrations/handoff/:code`, HMAC S2S guarded, single-use
- LMS: `POST /live-classes/:id/handoff` → mints ticket, stores code, returns
  the CLT URL (does not redirect yet)
- CLT: `POST /api/lms/enter` — exchanges the code, verifies, mints, returns the
  connection object
- Tests: code is single-use, expires, wrong HMAC refused, replay refused

**Exit:** curl can walk the whole chain and get a LiveKit token.

### Phase 2 — CLT entry route

- `frontend/src/routes` — add `/lms/enter`
- Page: POST the code, write `sessionStorage['lk-<room>']`, `navigate` to
  `/meeting/<room>`; render the real error for `TOO_EARLY`, `NOT_BOOKED`,
  `CLASS_ENDED`, `not started yet`
- Confirm `isMentor` / host controls derive from the **token**, not from a CLT
  account (`Classroom.jsx:99` says they do — verify, do not assume)
- Carry `returnUrl` from the ticket; "Leave" goes back to the LMS class page

- staff: JIT-provision / re-sync the CLT account from the ticket (§3b)
- students: no account — ephemeral session only

**Exit:** pasting a handoff URL lands in the room as the right role, and a
staff member arrives with the right CLT role.

### Phase 3 — watermark parity (blocking for students)

Port `WatermarkOverlay` to CLT, fed by the ticket identity. Non-negotiable
before students are redirected — see §5.

### Phase 4 — LMS switches to redirects, behind a flag

`LIVE_CLASS_HANDOFF=embed | redirect`

- client: `/live-classes/:id/watch` → **Join the class** becomes a redirect
- client: the booking modal's **Join the Class** likewise
- admin: studio and monitor → **Start the room** / **Watch hidden** /
  **Join visibly** become redirects
- keep `isInteractiveRoom()` as the single predicate for which classes redirect

**Exit:** flag flipped in dev, all five roles verified end to end.

### Phase 5 — admin visibility toggle, and avatars

- `mayUnhide` from §3, plus the in-room control on CLT
- `avatarUrl` on the ticket → LiveKit metadata → participant tile (§3c)

### Phase 6 — cleanup

- delete `LiveKitStudio.tsx`, `LiveKitRoomView.tsx`
- drop `livekit-client`, `@livekit/components-react`, `@livekit/components-styles`
  from both LMS apps
- update `docs/CLT_INTEGRATION.md`
- remove the flag

---

## 5. What must not be lost

| Thing | Today | Risk | Mitigation |
|---|---|---|---|
| **Forensic watermark** | student email drifts over live video | **Disappears entirely on CLT** — the reason the original plan chose an embed over an iframe | Phase 3, blocking |
| Entitlement | LMS decides, every time | unchanged | ticket contract untouched |
| Attendance | `participant.joined` webhook | unchanged | CLT already sends it |
| Hidden admin | invisible in participant list | unchanged | token grant, server-enforced |
| Refresh mid-class | re-renders in place | ticket is single-use → refresh could dead-end | short room-scoped CLT session cookie, or re-enter via the LMS button |
| Branding | students never leave Delta | they now land on another origin | CLT theming for LMS entries |
| Revocation | none today either | a blocked student keeps their token | out of scope; note it, do not pretend it regressed |

---

## 6. Open questions for the owner

1. ~~The role mapping table~~ — **implemented**, see §3b. The only live
   question left is whether the four programme-scoped roles should keep
   `SCOPED_ADMIN_TIER = user` (recommended, preserves the LMS's scoping) or be
   widened to `admin` so they reach CLT's recordings list.
2. **Same browser tab or new one?** A new tab keeps the LMS state alive behind
   the class; same tab is simpler and works on mobile. Recommend same tab with
   a return URL.
3. ~~CLT accounts for LMS users~~ — **settled in §3b**: JIT accounts for
   staff, ephemeral sessions for students.
4. **Domain** — a `meet.` subdomain of the same parent domain would let a
   `SameSite=Lax` cookie survive the hop and keeps the brand continuous.
5. Given §0, is the watermark work worth the trade, or is the embed still the
   better answer for students, with redirects only for staff?
