# 🔐 Security Audit — Delta LMS Monorepo

**Status: 1 open**, and it is not a code fix — a single Cloudflare bucket setting that nothing in the repository can read.

A **functional round** on 2026-08-10 then asked the opposite question from every security round — *does the product still work, for everyone?* — and found six more defects, one of them a security hole (`support` could publish to the public website). All six are fixed; see §4.

Everything else raised across five rounds is closed, and each fix is pinned by a test that fails when the fix is reverted. Backend, admin and client all type-check clean.

| | |
|---|---|
| **Original audit** | 2026-08-05 — 65 findings (2 critical · 21 high · 28 medium · 14 low) |
| **Remediation round 1** | 2026-08-06 — 58 of the 65 closed; 11 new findings surfaced during the work (N-01 … N-11), 10 fixed |
| **Bug-bounty round** | 2026-08-07 — independent pass over the whole monorepo. **26 new findings (P-01 … P-26)** |
| **Remediation round 2** | 2026-08-07 — all 26 P-series findings closed, plus N-01 |
| **Full re-audit** | 2026-08-07 — all 27 fixes re-verified (36/36 checks). Reviewed the areas earlier rounds never reached — jobs, Mux, Google Meet, WhatsApp, TOTP, enrolment, own-data routes. **2 new findings (NEW-01, NEW-02)**; NEW-02 fixed |
| **Remediation round 3** | 2026-08-08 — the deferred ones closed one at a time, each with its own suite: NEW-01, P-22, L-06, L-09, M-04, P-10, **M-21**, **M-05 in full**, and **H-11 measured rather than assumed**. 283 checks across 10 suites |
| **Bug-bounty round 2** | 2026-08-08 — fresh pass over all 182 endpoints plus targeted hunts for bug *classes* earlier rounds never searched for. **6 findings (B-01 … B-06)**, all fixed. B-01 had been mischarging every non-USD order; B-06 surfaced from a failing assertion while fixing it. See §3 |
| **Functional round** | 2026-08-10 — triggered by a real bug report. Asked whether each panel still WORKS rather than whether it is guarded, across all 9 roles and both academies. **5 further findings (B-07 … B-10 plus a Google failure path)**, all fixed. 778 checks across 13 suites. See §4 |

---

## 1. Where things stand

### Code findings, all rounds

| Round | Raised | Fixed | **Open** |
|-------|--------|-------|------|
| Original audit (2026-08-05) | 65 | 65 | 0 |
| Found during remediation (N-01 … N-11) | 11 | 11 | 0 |
| Bug bounty 1 (P-01 … P-26) | 26 | 26 | 0 |
| Re-audit (NEW-01, NEW-02) | 2 | 2 | 0 |
| **Bug bounty 2 (B-01 … B-06)** | **6** | **6** | **0** |
| **Total** | **110** | **110** | **0** |

The single open item, H-11, is counted as fixed here because its code fix landed in round 1; what remains is an infrastructure setting, described below.

### Still open — 1

| ID | Sev | What | Waiting on |
|----|-----|------|-----------|
| **H-11 / N-06** | 🟠 High → **Low in practice** | Whether the `lms-delta-kyc` bucket has its **own** managed `r2.dev` URL enabled. Everything else about this finding is now measured: no scan is reachable through the known public hostname, no scan sits in the public bucket, and `migrate-kyc` has nothing to move | One console setting, or one API call. `bun run verify-kyc` re-checks the rest on demand and exits non-zero if anything answers |

**On H-11:** the reason it cannot be closed from here is narrow — that hostname is a random per-bucket id, exposed by neither the S3 API nor anything in the codebase. If it *is* enabled, an attacker would still have to discover a 32-hex string that appears nowhere in the system — real, but not the open door the finding described.

Every item that was open a day ago was recorded as blocked on something outside the code — a maintenance window, a signup rework, a console check, a pricing decision, a product decision. Four of the five turned out to be avoidable: the work was to find the version of the fix that did not require the decision. M-21 evicts the old cookie instead of signing everyone out; M-05 moves the uploads instead of rewriting signup; B-01 leaves every existing course on its current fallback so nothing reprices; B-03 keeps today's behaviour and puts the stricter policy behind a switch. Only the Cloudflare setting genuinely cannot be settled from here.

**Not counted as open:** M-03 (refresh grace window) and L-10 (unpaginated live-class list) are deliberate designs — removing them re-creates the bugs they were built to fix.

### Dependencies — 14 of 15 advisories closed, without a major upgrade

| Package | Before | Now | How |
|---------|--------|-----|-----|
| backend | 12 (3 high) | **1 moderate**, unreachable — see below | three `overrides` |
| admin | 17 (8 high · **1 critical**) | **0** | two `overrides` |
| client | 15 (8 high) | **0** | two `overrides` |

**The record previously said these needed parent major bumps, including
`next@16`. They did not.** Every one was a *transitive* advisory — a leaf
package pulled in by a dependency, at a version its parent's own range already
permitted. `overrides` is the tool for exactly that, and it had not been tried:

| Advisory | Was | Now |
|---|---|---|
| `brace-expansion` DoS ×3 (high) | 2.1.1 | **2.1.4** — one copy, no nested duplicates |
| `sharp` libvips CVEs ×4 (high) | 0.34.5 | **0.35.3** |
| `postcss` sourceMappingURL (high) | 8.4.31 | **8.5.26** |
| `@opentelemetry/core` baggage (moderate) | <2.8.0 | **2.10.0** |
| `body-parser` limit bypass (low) | 1.19.x | **1.20.6** |
| `qs` stringify DoS (moderate) | 6.15.1 | **6.15.3 top-level; two nested copies remain** |

**`next@16` was not needed.** Both frontend advisories lived in `next`'s own
nested copies — `sharp` as an optionalDependency, `postcss` pinned *exactly*.
npm refuses a literal override that conflicts with a direct dependency, so the
working form was to raise the direct range and pin every nested copy to it with
`"sharp": "$sharp"` / `"postcss": "$postcss"`.

#### The one that is not fixed, and why it is being left

`node_modules/body-parser/node_modules/qs` and
`node_modules/googleapis-common/node_modules/qs` are both still **6.15.1**,
inside the advisory range. Bun's `overrides` do not reach them. Three things
were tried: the override alone, `bun install --force`, and deleting `bun.lock`
for a full re-resolution. **None moved them**, and the last one bumped
`stripe` 22.1.1 → 22.4.0, which broke the build:

```
src/services/stripe.service.ts(16,5): error TS2322:
Type '"2026-04-22.dahlia"' is not assignable to type '"2026-07-29.dahlia"'.
```

That is the same regression an earlier round hit with `bun update` and reverted
— documented on this page, and repeated anyway. The lockfile was restored,
`stripe` is back at 22.1.1, and the build, boot and suite are green again.

**It is being left because the vulnerable code is not reachable.** The advisory
is a DoS in `qs.stringify` with `arrayFormat: 'comma'` and `encodeValuesOnly`
set. Express and `body-parser` use qs for **parsing** — `qs.parse` — and
nothing in this codebase calls `stringify` at all. `googleapis-common` builds
query strings from its own internal parameters, not from request input.

Revisit when `express@4.x` ships with a newer `qs` pin, or when Bun's override
resolution covers nested dependencies. `bun audit` will keep reporting **"No
vulnerabilities found"** in the meantime — it reads resolutions rather than the
directory tree, which is how these two copies went unnoticed in the first
place.

**Verified against the installed tree, not the auditor.** Every version above
was read from the `package.json` on disk. (`@types/qs` and `@types/body-parser`
also sit at vulnerable-looking versions and are ignored deliberately: they are
type declarations, not code.)

**Changed deliberately in earlier rounds:** `nodemailer` 8.0.7 → **9.0.5** (a
file-read/SSRF advisory), `express` → 4.22.2, `mongoose` → 8.24.2, `multer` →
2.2.0, and `next-auth` **removed** from admin — a CRITICAL advisory in a package
nothing imported.

**Re-verified after the change:** all three packages type-check, the backend
bundles (3228 modules) and boots clean, and **both Next production builds
succeed** — the real test, since `sharp` is a native module and `postcss`
drives the CSS pipeline.

### Still outstanding — none of it is a missing guard

| What | Type | Needs |
|------|------|-------|
| **Commit the working tree** | ⚠️ risk | Still **0 commits ahead of `main`** with ~90 changed files. One `git checkout` destroys both remediation rounds. **The single largest risk on this page.** |
| `ABZER_WEBHOOK_SECRET` in the Abzer console | operational | **P-01's fix depends on it** — the webhook is now the only thing that can fulfil an Abzer order |
| `TAMARA_BASE_URL` off the sandbox | operational | **P-02's fix depends on it** — every sandbox authorise fails, and fulfilment now correctly refuses on a failed authorise |
| Confirm public access on `lms-delta-kyc` | operational | The one thing `bun run verify-kyc` cannot answer. Nothing else remains for H-11: 0 objects to migrate, 0 scans reachable |
| Clear 2 dangling document references | cosmetic | `bjm1430796@gmail.com` and `r2test_1782252689@test.com` point at objects that no longer exist — a broken link in the admin panel, not an exposure |
| `PROXY_SHARED_SECRET` | ✅ **set** | Generated (32 random bytes) and written identically to all three `.env` files, which activates M-11 — rate limits now key per person rather than one platform-wide bucket. `.env` is gitignored, so **the same value must be set in production** or the relay is ignored and behaviour silently reverts |
| `RAZORPAY_WEBHOOK_SECRET` | operational | Blank — the drop-off rescue for Razorpay is off (C-01) |
| `JWT_ACCESS_EXPIRES_IN` 1h → 15m | ✅ **done** | Now 15m, closing the residual window P-06 left. The client refreshes automatically, so the only visible effect is more refresh calls |
| **`JWT_ENFORCE_AUDIENCE=true`** | operational | **Stage 2 of L-06.** Set it once 30 days have passed since deploy, so every audience-less legacy token has expired. Early = everyone signed out; never = the claims are decorative |
| M-05 · `SIGNUP_REQUIRE_VERIFICATION` | **optional** | Now safe to enable — the prerequisite is done. Off by default because it makes mail deliverability gate first sign-in, which is a product call, not a defect |
| Unreferenced `kyc/` objects | operational | An abandoned signup can leave stored files nobody references. No sweeper exists; worth a periodic job (see §M-05) |
| M-03, L-10 | — | Deliberate designs. No change recommended |

---

## 2. What was fixed

### 🔴 Critical — payment fulfilment could be self-served

**P-01 · Abzer `verify-return` fulfilled with no verification at all**
`services/order.service.ts`, `services/abzer.service.ts`

`POST /checkout/abzer/verify-return` marked the caller's own pending order `paid`, created the enrolment and set `enrollmentStatus: 'approved'` — without asking Abzer anything, because `AbzerService` has no status-lookup method to call. Three requests (register → create-order → verify-return) bought any course free *and* promoted a browse-only viewer to an approved student. The optional `transactionId` even defaulted to the literal `'return-url-fallback'`.

**Fixed** — the endpoint is now **read-only**. The Abzer *webhook* (which verifies `X-Abzer-Secret`) was always the verified path; this was the unverified shortcut. It now reports order status and waits out a 4-second grace window for the callback, because the browser redirect routinely beats the server-to-server webhook by a few hundred milliseconds. The response gained a `paid` field; the client reads only `needsRegistration`, so it stays source-compatible.

**P-02 · Tamara fulfilled regardless of what Tamara answered**
`services/tamara.service.ts`, `services/order.service.ts`

`authoriseOrder()` and `captureOrder()` returned `void` and logged failures as `"(non-fatal)"`, so the caller could not distinguish an approved order from a rejected one — and marked it paid either way. Same three-request exploit as P-01.

**Fixed** — both return a boolean, and fulfilment is gated on the **authorise** succeeding: that is the point at which funds are committed, so it is the honest gate. A failed *capture* after a good authorise still fulfils (the customer has committed) but logs an error for settlement follow-up rather than swallowing it.

### 🟠 High

| ID | Finding | Fix |
|----|---------|-----|
| **P-03** | Tabby fulfilment fell open when the status lookup threw — the guard read `if (verifiedStatus && …)`, so an undefined status skipped it entirely. Every pending order was self-fulfillable during a Tabby outage | A failed lookup now refuses fulfilment. A check that cannot run has not passed |
| **P-04** | `GET /admin/bookings?liveClassId=` **overwrote** its own tenancy and instructor filter, so any instructor or staff account in either academy could pull another academy's full roster — student names and emails | The requested id is now intersected with the scoped set; out-of-scope returns an empty page |
| **P-05** | `PATCH /admin/bookings/:id/attendance` had no ownership or tenancy check. Attendance feeds the 2×-attendance cap, so a forged mark locks a student out of a class they never took | `callerMayManageSession()` before the write; 404 across an academy boundary |
| **P-06** | Access tokens were never checked against the account. Revocation only touched *refresh* tokens, so blocking, deleting or demoting someone left their token fully usable for up to an hour | All four guards load the account, refuse it if gone (`ACCOUNT_GONE`) or disabled (`ACCOUNT_DISABLED`), and take `role` from the **record**. Not a new query — they already fetched that document. Bonus: `authenticateAny` now populates `organizationId`, closing the residual N-07 gap |
| **P-07** | **No identity document could be saved by anyone.** `/uploads/kyc` returns a bare key by design since H-11; four schemas still demanded `z.string().url()` and answered 422. In registration the failure lands *after* the account exists | New `utils/documentRef.ts` accepts a `kyc/` key **or** a URL on our own storage, applied to all six document fields |
| **P-08** | **No admin could upload a file.** The admin proxy read bodies with `req.text()`, destroying binary; uploads then failed magic-byte verification with a message blaming the file | `req.arrayBuffer()`, matching the client proxy |
| **P-09** | 12 / 17 / 15 advisories, including a CRITICAL `next-auth` that nothing imported. M-26 / M-27 / M-28 had been recorded closed but the *installed* tree still resolved to affected versions | `next-auth` removed; `nodemailer`, `express`, `mongoose`, `multer` bumped; frontends `npm audit fix`'d |

### 🟡 Medium

| ID | Finding | Fix |
|----|---------|-----|
| **P-11** | `DELETE`/`PATCH /admin/enrollments/:id` had no tenancy check — the programme check was skipped entirely by `isFullAdmin`, which includes the org-scoped `admin` role. A Dubai admin could revoke a Bangalore student's paid access or rewrite their module gating | `callerMayAccessUser()` **before** the `isFullAdmin` short-circuit |
| **P-12** | `GET /admin/live-classes/:id/feedback` — no ownership or tenancy; returned student names, emails and private ratings | `callerMayManageSession()` |
| **P-13** | `/admin/reports/attendance` was academy-scoped but not instructor-scoped, so an instructor got every student's attendance across the academy. A staff account with no academy got the whole platform | Instructor scope added. Reports is admin-only in the sidebar, so no screen changed |
| **P-14** | `POST /admin/bookings/book-for-student` resolved session and student by raw id with no academy check | Tenancy on **both** sides |
| **P-15** | `/uploads/presign` and `/uploads/video` were open to every authenticated account — a pending viewer who had paid nothing could mint unlimited presigned PUTs into the production media bucket | `requireInstructor`. Verified no student flow depends on it |
| **P-16** | `PATCH /admin/live-classes/:id` copied `courseId`/`instructorId` straight from the body after validating only the *current* session, so a session could be re-parented to any course in any academy | Target course validated through `assertCourseEditable`; instructors can no longer reassign `instructorId` |
| **P-17** | Mentor availability's self-check bound only the `instructor` role; every other staff role could read and **overwrite** any mentor's schedule in either academy | Academy scope on GET and PUT |
| **P-18** | `ACCOUNT_GONE` failed **open** on two listings — `typeof callerOrg === 'string' ? … : undefined` collapsed "deleted account" into "unscoped", handing a deleted admin the whole platform's audit trail and every academy's support tickets | New `callerIsGone()` in `utils/tenancy.ts`; both call sites deny |
| **P-10** | Custom roles and permissions are stored but read by nothing — the screen grants and revokes nothing | ✅ Fixed — `requirePermission()` on 30 route positions, **narrow-only**. See below |
| **N-01** | Fixed-amount coupons were currency-blind | ✅ Fixed — see §3 |

### 🔵 Low

| ID | Finding | Fix |
|----|---------|-----|
| **P-19** | `PATCH /auth/me/enrollment-docs` accepted any absolute URL, which the admin panel then loaded while reviewing an enrolment | Folded into P-07 — values restricted to our own storage |
| **P-20** | Q&A threads and assignment instructions were readable without enrolment | Enrolment gate; staff read freely; free-preview lessons stay open |
| **P-21** | `super_admin` missing from several `requireRole('admin','instructor')` lists — the highest-privilege role got 403 on homework, thread pinning and learning paths | Added everywhere, including `reviews.routes.ts` which the original report missed |
| **P-22** | Learning paths had **no ownership and no academy** — `PATCH` was open to every instructor on the platform, `DELETE` to every admin, and the model carried no `organizationId` at all | Both halves closed — see below |

### M-05 · Registration enumeration — the timing oracle nobody had noticed
`services/auth.service.ts`, `services/email.service.ts`

The finding was recorded as "registration returns `EMAIL_TAKEN`". Measuring it first turned up a **second, independent channel** that the status code was hiding:

| | Response time |
|---|---|
| existing email | **6 ms** |
| new email | **263 ms** |

`emailExists()` short-circuited *before* bcrypt, so a taken address answered ~250ms faster. An attacker never had to read the response at all — only time it. That oracle would have survived any amount of rewording of the error, which is what a message-only "fix" would have delivered.

**Fixed** — the password is hashed *before* the existence check, so both paths pay the same bcrypt cost. Measured after: **14 ms** apart, below network jitter. The wasted hash on the taken path is the point.

**Also added** — the *account holder* is emailed when someone tries to register with their address. That turns a silent probe into something its owner can see, and it is the right message for the common innocent case: a real person who forgot they already signed up. It says nothing about the attempt beyond the fact of it — no IP, no name, nothing an attacker could plant in someone's inbox.

**The rest — built, tested, and deliberately switched off.** Registration **auto-logs-in**: a fresh address returns a *session*, a taken one an error. Distinguishable no matter what the error says, because the attacker just checks whether they got logged in. The only fix is to stop issuing a session at signup, so both answers become "check your inbox".

That is implemented behind **`SIGNUP_REQUIRE_VERIFICATION`** and covered by tests in both modes — verified that the two outcomes become byte-identical (`{verificationRequired: true}`), that no session is issued, and that the account is still created and simply unusable until the link is followed. Default mode is unchanged.

**It shipped off because of a blocker found by building it, not by guessing:** the full signup flow uploaded passport and ID scans in **four authenticated calls _after_ registering**, using the session it would no longer issue. Enabled as it stood, every full signup would silently have lost its documents — worse than the leak it closes.

**That blocker is now closed.** The documents go up **before** the account exists, through a new `POST /uploads/signup-doc`, and their references travel in with the register payload. Registration became one request that needs no session on either side of it:

| | Before | Now |
|---|---|---|
| Requests to complete a full signup | 1 register + 3 uploads + 2 profile patches | **3 uploads, then 1 register** |
| Calls needing a session | 5, all after register | **none** |
| With verification-first on | all 5 fail; documents lost silently | completes normally |

**Why the files were not simply attached to the register request instead.** That was the obvious shape, and it would have re-opened M-05 from the other end. File writes only happen for an address that is actually new, so a registration carrying 9 MB would answer *seconds* slower for a fresh email than a taken one — a far louder oracle than the 250 ms bcrypt gap this finding started with. Keeping the uploads in their own request leaves register's timing flat on both paths, which is the property the whole finding is about.

**The one new anonymous surface, and what bounds it.** `/uploads/signup-doc` is the only route in the system that writes to storage without a session — it cannot have one, because the account does not exist yet. It carries its own hourly limiter (`RATE_LIMIT_SIGNUP_UPLOAD_MAX`, 15/hour/IP — three uploads is one complete signup), a 3 MB cap, the same magic-byte check every other upload gets, and a `kind` that defaults *away* from the public bucket so a typo cannot put a passport somewhere readable. Worst case from one address is ~45 MB/hour into a bucket nothing serves publicly. The signup form also caches what it has already stored, so a retry after a rejected registration neither spends the budget again nor orphans a second copy.

**Residual, stated plainly:** a signup abandoned after uploading leaves files nobody references, and there is no sweeper for them. Worth a periodic job that deletes unreferenced `kyc/` objects older than ~30 days; not built here.

The boot-time error is gone — it logs an informational line now. `SIGNUP_REQUIRE_VERIFICATION=true` is safe to enable, and what remains is a product decision about mail deliverability, not a defect.

### H-11 / N-06 · Identity scans — what is actually true, measured
`scripts/verify-kyc.ts`, `scripts/migrate-kyc.ts`, `routes/documents.routes.ts`, `app.ts`

This sat open for three rounds with "needs a Cloudflare console check" against it — a poor place for the most sensitive data in the system to live, because nobody re-runs a console check in CI and a setting flipped six months from now goes unnoticed. Most of it turned out to be **observable**, so it is now observed by `bun run verify-kyc`, which exits non-zero if anything answers.

**What was found, none of which matched the record:**

| | Recorded | Measured |
|---|---|---|
| Legacy scans in the public bucket | 2, awaiting migration | **0** — both references are dangling; the objects are not in `lms-delta` or anywhere else |
| `migrate-kyc --apply` | the outstanding action | **a no-op** — "would move: 0" |
| KYC storage | unverified | `lms-delta-kyc`, **12 objects**, all under `kyc/`, none in the public bucket |
| Public reachability | unknown | every existing scan **refused**, against a control that proves the public path works |

**The check that nearly lied, and the correction.** The first version of `verify-kyc` reported a clean bill of health: every probe came back 404. That result was worthless. Two of those 404s were objects that **do not exist**, and one was a bucket with no public hostname — neither is evidence that access control works. A probe that cannot tell *refused* from *not there* proves nothing, and it would have been reported as an all-clear.

It now does two things before believing any refusal:

1. **A control probe.** A known-public object — a real avatar under `R2_PUBLIC_URL` — must return 200/206. It does (`206 · image/png`), so the public path is live and a 404 elsewhere means something. If the control ever fails, the run reports **INCONCLUSIVE** (exit 2), not clean.
2. **An existence check** over the S3 API for every key probed, so a 404 on a missing object is reported as `n/a — proves nothing` rather than as a pass.

With that in place: five KYC objects **that exist** are refused by the public hostname, and the app refuses to serve `kyc/` statically in lower, upper and mixed case, and through a traversal.

**What this still cannot establish, stated plainly:** whether `lms-delta-kyc` has its own managed `r2.dev` URL enabled. That hostname is a random per-bucket id — not derivable from the code, the database, or the S3 API, which does not expose the setting. The exposure if it *were* enabled is real but much narrower than the finding implied: an attacker would need to discover a random 32-hex hostname that appears nowhere in the system. Settle it in the console (R2 → bucket → Settings → Public access) or with an API token:

```
GET /accounts/<account_id>/r2/buckets/lms-delta-kyc/domains/managed
```

**The migration was reporting dishonestly.** A reference whose object is gone reads from the database exactly like one that has not been migrated yet, and the two mean opposite things — a broken link versus a document sitting in a public bucket. The dry run said "would move 2" when neither could move, and `--apply` would have counted both as failures. It now checks existence first and reports `object missing: 2` separately, so the summary reads `would move: 0`.

**Left for you, and it is cosmetic:** two `enrollmentApplication.passportUrl` values point at objects that no longer exist (`bjm1430796@gmail.com`, `r2test_1782252689@test.com`). Not an exposure — there is nothing there to expose — but the admin panel will render a broken document link. Clearing them is a write to live user records, so it was not done unasked.

### M-21 · Session cookies were readable by every subdomain
`utils/authCookies.ts`

Both cookies were pinned to `.deltainstitutions.com` in production, so anything on any sibling host — a marketing page, a status page, a forgotten staging box — could read a live admin session. The shared scope was never needed: both frontends proxy `/api/v1/*` from their own origin, so the browser only ever exchanges these cookies with the host it is already on.

**Fixed** — no `Domain` attribute, so each cookie belongs to exactly the host that set it. `COOKIE_DOMAIN` restores a shared scope without a code change if the apps are ever split across hosts that must share one session.

**And it needs no maintenance window, which is the part worth reading.** This was recorded as "signs everyone out once". It does not have to. The real problem is subtler than a sign-out: old and new cookies share a *name*, so a browser holding both sends both, and the server reads whichever the browser lists first — the older one. For `lms_rt` that is a token which has already been rotated, and presenting a rotated token trips reuse detection, which invalidates **every session that account has**. A quiet scope change would have logged people out at random for days.

So every response that sets a cookie also **deletes the legacy-scoped twin**. Deletion is keyed on (name, domain, path) and the replacement carries a different domain, so the old cookie goes and the new one stays. The first login or token refresh after deploy swaps each user over silently. `LEGACY_COOKIE_DOMAIN` names what to evict and defaults to the value that was hardcoded here — exactly what is sitting in production browsers today.

Logout clears both scopes. Missing that would have meant "sign out" leaving a valid apex cookie in the jar.

### M-04 · Impersonation is now a revocable session with an actor trail
`models/schema.ts`, `controllers/admin.controller.ts`, `middleware/auth.middleware.ts`, `middleware/audit.middleware.ts`, `routes/admin.routes.ts`

Impersonation was a bare JWT. Two consequences: nothing recorded **who** was impersonating, and **"end impersonation" only meant the browser threw its copy away** — anyone still holding that token kept full access to the account until it expired. There was no way to stop it.

**Fixed** — an `ImpersonationSession` row *is* the session now. The token merely names it, and every request re-reads the row, so revoking it ends the session for **every holder at once**, not just the one who clicked the button. Deliberately not cached: caching would reintroduce the exact window revocation exists to close.

| Added | |
|---|---|
| `POST /admin/users/:id/impersonate` | creates the session row, returns its id alongside the token |
| `GET /admin/impersonation-sessions` | the trail — who was in which account, when, from where. Academy-scoped; readable by any full admin |
| `DELETE /admin/impersonation-sessions/:id` | ends one. Idempotent — the useful outcome is "it is off", not "I was first" |
| `POST /admin/impersonation-sessions/revoke-all` | the kill switch, for when you do not yet know which session is the problem |

The token carries an **actor claim** (`act`, following RFC 8693's actor/subject distinction) and the session id (`isn`). `req.user` still describes the *impersonated* account — authorisation must judge that, or impersonating a student would hand over the admin's own privileges — while the operator is recorded alongside. `audit.middleware.ts` now attributes actions to the **real operator**, keeping the borrowed account in `meta`. Before this there was simply nothing to attribute them to: an admin acting through impersonation was indistinguishable from the user acting themselves.

Rows are kept after they end. The point of an actor trail is answering "who was in that account" long after the fact, so there is deliberately no TTL index; expiry is enforced in code.

### L-06 · Admin and student tokens were interchangeable
`utils/jwt.ts`, `services/auth.service.ts`, `controllers/auth.controller.ts`, `middleware/auth.middleware.ts`, `controllers/admin.controller.ts`

Both portals sign with the same key and neither token carried `aud` or `iss`, so a student's client token was *structurally* valid on an admin endpoint — only the role check separated them. That is one missing guard away from a privilege boundary failing silently.

**Fixed, staged.** Every token now carries `iss` and an `aud` of `client` or `admin`; each guard declares what it accepts (`authenticate` → client, `authenticateAdmin` → admin, `authenticateAny` → either, deliberately, since it fronts endpoints both portals share). Refresh tokens are bound too, so a client refresh cookie cannot mint an admin session. Rotation preserves the audience — without that, the first refresh would silently downgrade an admin session to `client`.

**The rollout order matters more than the change.** There are 30-day refresh tokens in circulation carrying neither claim; rejecting them on deploy signs out every user at once. So:

| Stage | Behaviour | When |
|-------|-----------|------|
| **1 — now** | New tokens carry both claims. A token *without* them is still accepted | on deploy |
| **2 — later** | Set `JWT_ENFORCE_AUDIENCE=true`; absence becomes a rejection | after `JWT_REFRESH_EXPIRES_IN` (30d) has elapsed, by which point every legacy token has expired |

Flip stage 2 early and everyone is logged out; never flip it and the claims are decorative. **It belongs on the deploy checklist.**

Impersonation tokens are minted `admin`, because they are presented as a Bearer on admin-portal requests — mint them `client` and impersonation breaks the moment stage 2 lands. The unreachable second impersonation handler in `roles.controller.ts` was deleted rather than tagged: it minted audience-less tokens and would have broken at stage 2, on the most sensitive endpoint in the system.

### L-09 · AI chat had no per-user ceiling
`services/ai.service.ts`, `models/schema.ts`

The generation **timeout already existed** (`CHAT_TIMEOUT_MS`, raced against the call) — the report's claim that it was missing was stale. What was genuinely absent was a total cap: `searchRateLimit` bounds the burst at 30/min, but nothing stopped one account running the model all day.

**Fixed** — a per-user daily allowance counted **on the user document**, so it survives a restart and holds across PM2 instances; an in-process counter would reset on every deploy and hand each fork its own full allowance. The day is the local calendar date (the app runs on Asia/Dubai), so it resets at local midnight rather than an arbitrary UTC hour.

Default **100/day**, tunable via `AI_DAILY_MESSAGE_LIMIT`, `0` disables it. Deliberately set well above what a studying human does, because this is a cost guard rather than an anti-abuse guard — **it needed no product decision to ship, only a number generous enough to affect nobody.** The allowance is claimed *before* generation, so an abandoned or timed-out request still counts; otherwise the cheapest way past the cap would be to hang up on every response.

Two concurrent first-messages-of-the-day can each take the "new day" branch and lose one increment, so the cap can over-admit by one per day. That is the right trade for a cost guard — a transaction here would buy exactness nobody needs.

### P-22 · Learning paths had neither an owner nor an academy
`models/schema.ts`, `repositories/learningpath.repository.ts`, `services/learningpath.service.ts`, `routes/learningpaths.routes.ts`, `index.ts`

Two holes in one feature. `PATCH /learning-paths/:id` was open to every instructor on the platform and `DELETE` to every admin, with no owner check — so anyone could rewrite or unpublish a colleague's path by id. And `LearningPathSchema` had no `organizationId`, so neither academy was separated from the other at all.

**Fixed** in two steps. Ownership first (instructors confined to paths they authored), then the academy:

| Change | Where |
|--------|-------|
| `organizationId` added to the schema and indexed | `models/schema.ts` |
| Stamped from the creator's academy at create time | `adminCreate()` |
| `#assertOwned` applies **academy then ownership**, in that order — the same sequence the rest of the codebase uses. 404 rather than 403 throughout, so the endpoint never confirms an id exists in the other academy | `learningpath.service.ts` |
| Both list paths filter by academy using the standard `{org} OR {null} OR {missing}` shape, so legacy rows stay reachable | `learningpath.repository.ts` |
| Public list gained `optionalAuthenticate` and passes `req.user?.organizationId` — mirroring `GET /courses` exactly: a signed-in visitor sees their academy, an anonymous one sees the full catalogue | `learningpaths.routes.ts` |
| Existing rows stamped by the boot backfill alongside the other scoped models | `index.ts` |

`GET /learning-paths/:slug` is deliberately left unscoped, matching `courses.getBySlug` — a direct slug lookup of published content is open on both.
| **P-23** | The `/uploads/kyc` static block was case-sensitive, so `/uploads/KYC/…` fell through on a case-insensitive filesystem | Matched case-insensitively |
| **P-24** | `searchRateLimit` ran *before* `authenticate` on `/ai/chat`, so the limiter could never key per user | Order swapped. Unblocks L-09 |
| **P-25** | A second, dead impersonation handler shadowed by the first — unreachable, with different rules, on the most sensitive endpoint in the system | Removed |
| **P-26** | `POST /checkout/razorpay/verify` never checked order ownership, unlike the other three gateways | Optional `userId` checked; the webhook path is unchanged |
| **NEW-02** | Mux webhook signatures had **no freshness window** — see below | Timestamp now verified against the clock |

### P-10 · The permissions screen granted and revoked nothing
`middleware/auth.middleware.ts`, `routes/admin.routes.ts`, `routes/support.routes.ts`

`Role.permissions` — a full matrix of **11 resources × 7 actions** — and `User.customRoleId` were written by the admin UI, stored, listed back, and **read by no guard anywhere**. A "Read-only Support" role could be built, ticked down to `read`, assigned, and shown on the user's profile while that account kept every power its base role had. This is worse than having no such screen: it invites reliance on a control that does not exist, and nothing in the product ever contradicts the belief.

**The recorded blocker was false.** This finding had sat open because enforcing it "will revoke access someone holds today". A read-only query settled it:

| Real `lms` database | |
|---|---|
| Users with a `customRoleId` | **0 of 79** |
| Custom (non-system) roles defined | **0** — only the three seeded ones |

So enforcement is provably a **no-op on current data**. Nobody loses anything at deploy; the matrix simply starts working the day someone first uses it.

**The property that matters is that a custom role can only ever NARROW.** `requirePermission` is mounted *after* `requireRole`, never instead of it:

```ts
router.delete('/users/:id', requireAnyAdmin, requirePermission('users', 'delete'), ...)
```

If it had *replaced* the base check, `PATCH /admin/users/:userId/assign-role` would have become a privilege-escalation primitive — hand a student an all-permissions role and they become omnipotent. Both gates must pass, so the matrix can subtract and never add.

| Rule | Behaviour |
|------|-----------|
| No `customRoleId` | Untouched — no lookup, no cost. Everyone today |
| `super_admin` | Bypasses, matching every other guard in the codebase |
| Role deleted mid-session | **Fails closed** — `ROLE_NOT_FOUND` 403, not "no restrictions found, allow" |
| Denied | `PERMISSION_DENIED` naming the action and resource, so it is actionable rather than a blank 403 |

`PERMISSIONS_MODE` = `enforce` (default) · `report` (log only — measure impact before switching) · `off`.

**Applied to 30 positions covering all 11 resources.** A partially-enforced matrix is worse than none — "why does my no-coupons role still let me delete coupons?" — so users, courses, categories, coupons, orders, bookings, live-classes, reports, support, reviews and settings are all wired, not a convenient subset.

### NEW-01 · Enabling 2FA required no password — an unrecoverable lockout
`services/totp.service.ts`, `routes/totp.routes.ts`, `client/…/PrivacySecuritySection.tsx`

Turning 2FA **off** required the account password. Turning it **on** required only a live session:

```
POST /auth/2fa/setup    → logged in only       → hands back the secret
POST /auth/2fa/enable   → logged in only       → 2FA is now ON
POST /auth/2fa/disable  → logged in + PASSWORD ← the only one that asked
```

The code already knew a password was the right bar for touching 2FA; it applied it in one direction only. Anyone holding a session they did not own — a shared computer, an unlocked laptop — could request the secret, register it in *their* authenticator, enable 2FA and walk away. They gain nothing themselves: they never learn the password, and their session still expires.

**What made it more than a nuisance was that the owner could not recover:**

| Route back | Why it failed |
|---|---|
| Disable 2FA | Requires being logged in — which now needs the code |
| Forgot password | `resetPassword()` changes the hash and revokes sessions but leaves `twoFactorEnabled` untouched |
| Ask an admin | **No endpoint anywhere wrote `twoFactorEnabled`** except the two user-facing ones |

Recovery meant editing the database by hand. *(Initially rated Low on the reasoning that no data was stolen and no privilege gained. That was the wrong lens — unrecoverable denial of access to your own account is a real harm. Re-rated **Medium**.)*

**Fixed** — `setup()` now re-authenticates with the password, exactly as `disable()` does, and the client's 2FA panel asks for it before requesting a secret. Gating `setup()` alone is sufficient: `enable()` needs a valid code, a code needs the secret, and only `setup()` hands one out — so it is one password prompt, not two.

Added alongside: **`POST /admin/users/:id/reset-2fa`** (`requireAdmin`, tenancy-scoped, audited as `user.reset2fa`) for the genuine lost-phone case, which the password gate does not solve.

> **Deliberately not done:** clearing 2FA on password reset. It would have given the locked-out user a route back, but it also means anyone who can read the account's email defeats the second factor entirely — the opposite of what it exists for. Recovery belongs with a human who can verify identity out of band, which is what the admin endpoint provides.

### NEW-02 · Mux webhook signature had no freshness window
`services/mux.service.ts`

Mux signs each delivery as `Mux-Signature: t=<unix-seconds>,v1=<hmac>`, where the HMAC covers `<t>.<raw body>`. The signature was verified correctly — fail-closed without a secret, constant-time compare — but **the timestamp was only fed into the HMAC and never checked against the clock.**

Binding the signature to a moment in time is the entire reason the timestamp is in the header. Without that check a signature stays valid for as long as the secret does, so any captured callback replays forever: re-sending `video.live_stream.active` or `video.live_stream.idle` flips a session's status at will, and `video.asset.ready` re-attaches a recording.

**Fixed** — the timestamp is now compared against the clock with a 300-second tolerance (matching the Mux SDK's own default), overridable via `MUX_WEBHOOK_TOLERANCE_SECONDS`. Authenticity is checked *before* freshness so a rejection can be reported as "forged" or "replayed" rather than one indistinguishable failure, and stale rejections log at **warn** rather than dropping silently — if a legitimate retry ever lands outside the window it is visible, instead of a recording quietly failing to attach. The header parser was also tightened to split each pair on its first `=` only.

A far-future timestamp is refused as readily as a stale one: clock skew is suspect in either direction.

> Razorpay's webhook verification was checked at the same time and is sound — its protocol carries no timestamp to validate, and replay is covered by `fulfillFromWebhook` being idempotent.

---

## 3. Bug-bounty round — 2026-08-08

A fresh pass over the whole monorepo, deliberately not re-treading the earlier
rounds' ground: 182 endpoints enumerated and checked against their guards, then
targeted hunts for the bug *classes* prior rounds had not searched for —
mass assignment through validated bodies, dynamic query keys, schema/field
mismatches, secret exposure, and inconsistent gates between sibling routes.

**Six findings, all fixed.** The most serious is not a security hole — it is a
billing hole, and it had been charging customers the wrong amount on four of
the five payment gateways.

| ID | Sev | Finding | State |
|----|-----|---------|-------|
| **B-01** | 🟠 High | `priceAED` and `priceINR` were accepted everywhere and stored nowhere. Every non-USD checkout charged a fallback conversion rate | ✅ Fixed |
| **B-06** | 🟡 Medium | Clearing any nullable course field silently did nothing — `$set: {x: undefined}` is a no-op in Mongoose. Found while fixing B-01 | ✅ Fixed |
| **B-02** | 🔵 Low | `/uploads/signup-doc` accepted a PDF as a public profile photo | ✅ Fixed |
| **B-03** | 🔵 Low | `requireEnrollmentApproval` was on the Stripe checkout route and none of the other four | ✅ Fixed |
| **B-04** | ⚪ Info | An admin could create a course naming an instructor from the other academy | ✅ Fixed |
| **B-05** | ⚪ Info | `X-Organization-Id` was not validated as an ObjectId | ✅ Fixed |

### B-01 · The per-currency prices were accepted, then thrown away
`models/schema.ts`, `services/course.service.ts`, `controllers/admin.controller.ts`, `config/env.ts`, `admin/…/CourseForm.tsx`

The admin course form has a **"Price (INR) — Razorpay"** field: validated, with
quick-set buttons and the hint *"Leave blank to disable Razorpay for this
course."* The backend's `courseCreateSchema` accepted `priceINR`. The checkout
code read `priceAED` in five places and `priceINR` in two.

Neither field existed in the Course schema. Mongoose runs strict, so both were
**silently dropped on save** — and `.select('priceAED price status isFree')`
was selecting a path that was not there.

Measured against a throwaway database, entering the values the form offers:

| Admin enters | Was stored | Customer was charged |
|---|---|---|
| Price 100 (USD) | `price: 100` | — |
| Price (INR) **999** | *nothing* | **INR 8,300** — `price × 83`, hardcoded in source |
| Price (AED) **350** | *nothing* | **AED 367** — `price × UAE_EXCHANGE_RATE` |

**Fixed** — both fields are declared, validated, threaded through create and
update, and returned by the DTO so the form round-trips. The hardcoded `83`
became `INR_EXCHANGE_RATE`, mirroring `UAE_EXCHANGE_RATE`, and defaults to 83.

**Nothing reprices on deploy, which was the reason this was worth care.** No
course in the database carries an override — they never could — so every one
of them still converts at the configured rate exactly as before. The new
behaviour only engages the first time an admin sets a price, which is what they
were trying to do all along. Phase B-01b of the suite exists solely to pin
that: a course *without* overrides must still fall back.

**The admin hint was also a lie and is corrected.** "Leave blank to disable
Razorpay for this course" was untrue twice over: the value was never stored,
and the gateway is chosen by the academy's currency rather than by this field.
Both currency fields now say they fall back to the configured rate. A real
per-course gateway toggle would be a feature — and note it could not simply be
inferred from a blank field, because every existing course is blank.

### B-06 · Clearing a field silently did nothing
`repositories/course.repository.ts` — found while fixing B-01

`updateOne_` sent `{ $set: data }`, and Mongoose strips `undefined` values out
of `$set`. The service layer wrote `= undefined` in five places —
`priceAED`, `priceINR`, `level`, `categoryId`, `program` — on the assumption
that it cleared the field. It never did. Removing a course's level appeared to
succeed and changed nothing.

Surfaced by a failing assertion rather than by reading: marking a course free
left its INR override in place. The immediate risk was contained (the checkout
guard refuses a free course before pricing it), but the same line governs four
other fields.

**Fixed** — the repository splits `undefined` out into `$unset`. One line, five
fields.

### B-03 · Only one of five checkout routes checked enrolment state
`routes/checkout.routes.ts`, `middleware/auth.middleware.ts`

`POST /checkout/` (Stripe) carried `requireEnrollmentApproval`. The Razorpay,
Tabby, Abzer and Tamara routes did not. Paying is a **designed** path to
approval — `_autoApproveViaPayment()` promotes a viewer *or a rejected user*,
clears `rejectionReason`, and records `approvedByName: 'Paid Enrollment'`. So
the four unguarded routes matched the intent and Stripe was the outlier: a
pending applicant was refused by the one gateway on the flow built to approve
them.

**Fixed** — all five now share `requireCheckoutEligibility`. It permits
`pending` deliberately, which is the pay-to-enrol flow, and by default leaves
`rejected` alone, which is exactly what the four majority routes already did.
So no behaviour changes for anyone today, and the inconsistency is gone.

The question underneath it — *should an applicant an admin explicitly turned
away be able to buy their way back in?* — is a product decision, not a bug, so
it is a switch rather than a silent change: **`CHECKOUT_BLOCK_REJECTED=true`**
makes a rejection final across all five gateways at once. Off by default.
(Blocking with `isActive: false` is separate and still absolute — it stops
login outright.)

### B-04 · Cross-academy instructor assignment
`controllers/admin.controller.ts`

`createCourse` and `updateCourse` took `instructorId` from the body for any
admin role with nothing checking that the person named teaches at the caller's
academy. Not exploitable — `assertSameOrganization` blocks the assignee from
editing a course in the other academy, so they gained nothing — but the
catalogue would credit an instructor from the wrong academy, and a nonexistent
id produced a course whose author never resolves.

**Fixed** — one guard on both paths: the id must be valid, the account must
exist, it must not be disabled, and it must belong to the caller's academy.
super_admin stays unscoped, matching every other tenancy guard, and a caller
with no academy of their own stays unscoped too.

### B-05 · The org-switch header was unvalidated
`middleware/auth.middleware.ts`

`X-Organization-Id` was assigned straight to `req.user.organizationId` for
super_admin with no ObjectId check, so a malformed value reached a Mongoose
query and surfaced as a 500. **Fixed** — validated up front and refused with a
400. Refused rather than ignored: silently falling back to "all academies" is
the opposite of what a caller narrowing their scope intended.

### B-02 · A PDF could be a public profile photo
`routes/upload.routes.ts`

`/uploads/signup-doc` (added for M-05) shared `documentUpload`'s allow-list,
which permits `application/pdf` — correct for a passport, wrong for the one
thing that route stores publicly and that both apps render as an `<img>`. The
authenticated sibling `/uploads/image` already restricted to images; this did
not.

**Fixed** — `kind=photo` requires JPEG, PNG, GIF or WebP; identity scans still
accept PDF. Covered by three checks including that a repeated `kind` field —
legal in multipart — falls back to the *private* prefix.

### Four things this round changed about how the checks themselves work

All four came out of this round rather than the code under test, and all four
are the same failure: **a check that reports success without having established
anything.**

1. **`bun run verify-kyc` first reported a clean bill of health because every
   probe returned 404** — two of them for objects that do not exist, and one
   for a bucket with no public hostname. It now probes a known-PUBLIC object
   first and reports INCONCLUSIVE if that control fails, and checks existence
   over the S3 API before interpreting any refusal.
2. **`bun run migrate-kyc --clear-missing` printed "Cleared 2" while writing
   nothing**, because `delete` on a Mongoose subdocument is invisible to the
   change tracker. It now uses `$unset` and asserts `modifiedCount`.
3. **`bun audit` reported "No vulnerabilities found" while two vulnerable
   copies of `qs` sat in `node_modules`.** It reads resolutions, not the
   directory tree. Caught only by reading every `package.json` on disk. Worth
   remembering the next time a dependency report looks clean.
4. **The M-05 timing check flaked, and the first fix for it silently did
   nothing** — it raised `BCRYPT_ROUNDS` at runtime, but the config parses that
   once at import. It passed on a quiet machine and then failed 3 of 4 runs
   inside the full suite. It no longer compares two noisy measurements at all;
   it asserts a floor against one measured hash — see §6.

None of the four was caught by the check itself, and the timing one was not
caught by its own first repair either. Each was caught by looking at the thing
the check was supposed to be about: the bucket, the collection, and the
distribution. B-06 arrived the same way — through an assertion that failed, not
through a reading of the code.

The common shape is worth naming: **every one of them passed while establishing
nothing.** A green check is only evidence if you can say what a red one would
have looked like. Where that answer was not obvious, the fix was to give the
check a control (verify-kyc), a confirmation (modifiedCount), or a floor that
collapses rather than drifts when the property breaks (the timing check).

### Checked and clean

Enumerated all 182 endpoints and confirmed every one is covered by a route- or
router-level guard. Then, specifically:

- **Mass assignment** — the three `...req.body` spreads are all downstream of
  `validate()`, which replaces `req.body` with Zod's stripped output, so
  unknown keys cannot survive. Verified in `validate.middleware.ts` rather than
  assumed.
- **Dynamic query keys** — no computed `$set`/`$unset`/`$inc` keys anywhere; no
  `$where`, no `$function`.
- **Regex injection / ReDoS** — one `new RegExp` from user input, already
  escaped and length-capped.
- **Secret exposure** — `passwordHash` and `twoFactorSecret` are both
  `select: false`; the only `+twoFactorSecret` selections live inside
  `totp.service.ts` and never reach a response. No secrets in any log call.
- **XSS** — one `dangerouslySetInnerHTML` across both frontends, rendering a
  static font constant.
- **Price manipulation at checkout** — the client sends only `courseId` and
  `couponCode`; every amount is derived server-side.
- **Free-enrolment bypass** — `POST /enrollments` refuses paid courses with 402
  and enforces academy isolation.
- **Fulfilment idempotency** — every one of the eight fulfilment paths
  short-circuits on `status === 'paid'`.
- **Certificate enumeration** — certificate ids are `randomUUID()`, so the
  public verification endpoint cannot be walked.
- **Public endpoints** — `/instructors` returns name, avatar and headline only.
- **Open redirect** — the post-login `from` parameter is a bare pathname and
  has no consumer.
- **Impersonation token storage** — sessionStorage, not localStorage. It cannot
  be httpOnly (it travels in an `Authorization` header), and M-04's revocable
  session is the real mitigation.
- **Instructors reaching admin routes** — the admin router admits `instructor`
  and `support`, and twelve routes carry no further role gate. Every one of
  them lands on `assertCourseEditable` / `assertLessonEditable`, which refuse
  both roles. Traced rather than assumed.


---

## 4. Functional round — 2026-08-10

The security rounds asked "is this vulnerability closed?". Every suite in them
asserts on a **denial**, which makes them structurally blind to the opposite
defect: a guard that refuses something it should allow, or a path that breaks
for a role nobody tried. This round asked "does the product still work, for
everyone?" — and found six defects, one of them a security hole.

It started from a screenshot: **"Creation failed — Was there a typo in the url
or port?"** on the admin panel's New Staff Account modal.

### The reported error was mine, not the code's

All three dev servers were down. `npm install` and `npm run build` had been run
in both frontends, and `node_modules` reinstalled in the backend, **while those
servers were live** — which kills a Next dev server and leaves the admin panel
fetching a backend that no longer exists.

The flow itself was never broken. Driven through the real UI afterwards —
photo upload, name, email, password, Role: Instructor, Program: Digital
Marketing — it created the account, stored `category: 'digital-marketing'`, and
uploaded the avatar. The lesson is narrower than it looks: **do not rebuild a
running dev environment underneath itself.**

### Findings

| ID | Sev | Finding | State |
|----|-----|---------|-------|
| **B-07** | 🟠 Security | `support` — the lowest-privilege staff role — could create a course with `status: published` and it reached the **public catalogue**; it then could not edit or delete it | ✅ Fixed |
| **B-09** | 🟡 Functional | The entire Learning Paths section was dead in the admin panel | ✅ Fixed |
| **B-10** | 🟡 Robustness | A Google outage while scheduling a class surfaced as a generic 500 | ✅ Fixed |
| **B-06** | 🔵 Robustness | A malformed id returned 500 across several endpoints | ✅ Fixed |
| **B-08** | 🔵 Robustness | `?dateFrom=notadate` returned 500 | ✅ Fixed |

#### B-07 · A support account could publish to the public website
`middleware/auth.middleware.ts`, `routes/admin.routes.ts`

`POST /admin/courses` carried no role gate at all — only `requirePermission`,
which is a no-op for the accounts that exist today. Every role the admin router
admits could therefore author a course.

Measured rather than reasoned about: a `support` account created a course with
`status: 'published'`, and an **anonymous** request found it in
`GET /courses` and fetched it by slug. It could then neither edit nor delete
it, because `assertCourseEditable` refuses support — so a help-desk account
could publish to the marketing site and be unable to take it back down.

**Fixed** with `requireCourseAuthor`, scoped to exactly the roles
`assertCourseEditable` can authorise: *you may only create a course you could
afterwards manage.* Verified in both directions — `support`, `sub_admin` and
`ai_admin` are refused; `4x_admin` and `digital_marketing_admin` still author
normally. If sub_admin or ai_admin are meant to author courses, the fix is one
line in `assertCourseEditable`, not reopening creation.

#### B-09 · Learning Paths was dead in the admin panel
`routes/learningpaths.routes.ts`

All four staff routes used `authenticate`, which reads only the **client**
cookie (`lms_at`). The admin panel holds `lms_admin_at`, so every request
401'd, the axios interceptor refreshed the token, and it 401'd again — which
reads as a session problem rather than a wiring one.

Pre-existing, not introduced by the security work: the diff on that file only
added `optionalAuthenticate` for the public list. **Fixed** with
`authenticateAny`, which `/uploads` and `/documents` already use for the same
reason. Nothing widened — `requireRole` still restricts to staff, and P-06 has
`authenticateAny` populating `organizationId`, so P-22's academy scoping is
untouched. Verified live: list 200, create 201, patch 200, delete 204.

The same shape exists on three other routes — thread pin, instructor-answer,
review reply — but **no frontend calls them today**, so they are noted rather
than changed. Whichever portal eventually does will hit the same 401.

#### B-10 · A Google outage read as "unexpected error"
`controllers/liveClass.controller.ts`

Scheduling an **online** external session calls Google for a Meet link, and
`createGoogleMeetLink()` was awaited with no error handling. A rate limit, an
expired token or a network blip threw past the error middleware as a generic
500, and the class was not created.

It presented as an **intermittent** failure: the suite passed six times
standalone and failed inside the full chain, where the call is likelier to be
throttled. **Fixed** to log the cause and answer `503 MEET_LINK_UNAVAILABLE`
with an actionable message. The session is still deliberately not created on
failure — a live class with no join link would strand students who book it.
Whether an outage should instead create the session and let an admin attach a
link later (there is already a `/recreate` endpoint) is a product decision.

The suites also stopped making **real Google API calls on every run** — poor
hygiene, and the reason the failure was intermittent rather than reproducible.

#### B-06 · A malformed id returned 500
`repositories/base.repository.ts`, `services/certificate.service.ts`

`Model.findById('garbage')` throws a Mongoose CastError, which is not a
registered error class, so it fell through as *"An unexpected error occurred"*
with a stack trace — for a mistyped URL. Found by accident (a suite called a
route that does not exist), then generalised into a probe that fires a
malformed id at 21 endpoints, which caught `DELETE /admin/sections/:id` and
`DELETE /admin/lessons/:id` as well.

The root cause was **seven** admin controllers doing an ownership lookup before
the service validates. Fixed once in `base.repository.ts` — every repository
inherits it — so `findById` answers `null` for a value that cannot be an id.
No guard is weakened: the services still validate and refuse, and
`lessonService.create` independently requires the section to exist.

#### B-08 · An unparseable date returned 500
`routes/admin.routes.ts`

`?dateFrom=notadate` became an Invalid Date inside a Mongo range query. The
schema accepted any string. Now refused at the boundary with 422.

### New coverage

| Suite | Checks | Asks |
|-------|--------|------|
| `test:smoke` | **88** | Does each panel still do its job, end to end? |
| `test:adminmatrix` | **364** | What can each of the 9 roles do in each section, in both academies? |

`adminmatrix` exists because the honest answer to "have you tested every admin
section across roles?" was **no**: 19 of 105 admin endpoints, and 4 of 9 roles.
Five roles — `sub_admin`, `support`, `4x_admin`, `digital_marketing_admin`,
`ai_admin` — had never been exercised at all. B-07 came directly out of testing
them. It covers every sidebar section × every role × both academies, reads and
writes, an escalation ladder (no role may mint an account above itself), cross-
tenant probes, and 15 malformed-input variants.

### Three of the checks lied before they worked

Consistent with the pattern this engagement kept hitting — a check that passes
while establishing nothing:

- The catalogue probe asked `?search=Published by support`, got nothing back,
  and reported clean. The search simply did not match; a support account
  genuinely had a course on the public site. It now lists without a filter
  **and** fetches by slug.
- Probe slugs were built as `pub-4x_admin-…`. Underscores are illegal in a
  slug, so four roles answered 422 and never reached the guard being tested.
- The matrix's HTTP helper never stored `Set-Cookie`, so every request after
  login was anonymous — which read as "every role is denied everything".

### One correction to an earlier claim

The **Full Registration tab** was reported twice on this page as broken. It is
not. Every Framer Motion element on that page sits at `opacity: 0` in a hidden
browser pane — including the hero and the stats bar — because
`requestAnimationFrame` never fires when the tab is not compositing. Content
was being read through `innerText`, which ignores opacity, so the page looked
alive while nothing had animated. Two genuine full signups completed on the
live system that same day, through `/complete-registration`.

**Browser testing of animation-gated UI is unreliable in a hidden pane.** Any
future claim that an animated control "does not work" needs a visible pane or a
non-visual check.


---

## 5. N-01 · Coupon currency — and the regression the fix caused

**Decision taken:** `discountValue` is **major units of the owning academy's currency**. A Dubai coupon of `50` is 50 AED; a Bangalore coupon of `50` is ₹50. Cross-currency redemption is **refused**, not converted.

### It was worse than first recorded

Two things the earlier write-up got wrong:

**Per-org coupons do not pin the currency.** `getGatewayConfig()` is advisory — only `GET /checkout/config` reads it, to decide which buttons to draw. The five `create-order` routes never check the buyer's country or the course's academy, so the same coupon lands in an AED or an INR calculation purely on which endpoint is called.

**The documented unit was never the applied unit.** The schema comment, the service comment and the admin UI (`Fixed ($)`, rendering `$50`) all said USD — while Stripe, the only USD path, is unconfigured. A coupon entered as `50` gave:

| Path | Applied | Real value |
|------|---------|-----------|
| Abzer / Tamara | 50 AED | ≈ $13.62 |
| Razorpay | 50 INR | ≈ $0.60 |

≈ 22× apart, neither the advertised $50. And because the discount is capped at the order total, a value entered in the other academy's scale — `5000`, meaning ₹5,000 — exceeds a 367 AED course price and **zeroes the order**.

### The fix

| Change | Where |
|--------|-------|
| `currency` (`'AED' \| 'INR'`) on `CouponSchema`, stamped from the owning academy at create and immutable thereafter | `models/schema.ts`, `services/coupon.service.ts` |
| `applyDiscount(minorUnits, coupon, checkoutCurrency)` — percent unchanged (a ratio is currency-neutral); fixed requires a match, else `COUPON_CURRENCY_MISMATCH`; a fixed coupon with no currency is refused (`COUPON_CURRENCY_UNKNOWN`) rather than guessed | `services/coupon.service.ts` |
| All five call sites pass their gateway's currency | `services/order.service.ts` |
| Boot backfill stamps existing coupons from their academy, and logs an **error** naming any fixed coupon left without one | `index.ts` |
| Admin UI shows `AED 50` / `INR 500` instead of `$50`, labels the input with the academy's currency, flags a currency-less coupon | `admin/…/coupons/page.tsx` |

**Why refuse rather than convert:** there is no USD→INR rate in this codebase — `UAE_EXCHANGE_RATE` covers AED only and Razorpay hardcodes `83` inline. Adding a rate to the money path buys drift and rounding disputes to solve a case that should not arise.

### The regression it caused, caught and closed

Making `applyDiscount()` throw turned an infallible call into a fallible one — and every checkout path called it **after** claiming the coupon's usage slot:

```ts
const coupon  = await validateAndReserve(couponCode, courseId)   // ← slot claimed
const applied = applyDiscount(originalFils, coupon, CURRENCY)    // ← new throw
...
return this.releasingOnFailure(couponId, ...)                    // ← protection starts here
```

`releasingOnFailure` covers only the region *after* the reservation, and `couponId` was not yet assigned — so every mismatched attempt would have burned a use off `maxUses` permanently. That is N-03, reintroduced.

**Closed** by `CouponService.validateAndPrice(code, courseId, minorUnits, currency)`, which orders the steps correctly — validate → price → *then* claim — with all five checkout paths moved onto it.

> **Worth carrying forward:** the finding was not the currency bug, it was that **making an existing call throw moves where the failure boundary has to be.** Any future validation added between "reserve" and "release" needs the same look.

---

## 6. How coupons work *(reference)*

Each academy has entirely separate coupons. Uniqueness is on the **pair**, not the code:

```
CouponSchema.index({ code: 1, organizationId: 1 }, { unique: true })
```

The legacy global `code_1` index is dropped at boot, so Dubai and Bangalore can both run `SUMMER20` as independent coupons with different values, currencies and usage counters.

**Redemption resolves through the course, not the buyer:**

```
student enters SUMMER20 on course X
  → look up course X → its organizationId
  → findByCodeAndOrg('SUMMER20', thatOrg)
```

A Dubai code on a Bangalore course does not come back as "wrong academy" — it **does not exist**, and returns `COUPON_NOT_FOUND`. Tenancy resolved by construction rather than by a separate check, which is why it cannot be forgotten on a new route.

| Concern | Scoping |
|---------|---------|
| Admin list / create / edit / delete | Filtered by the admin's `organizationId`. super_admin selects via `X-Organization-Id`; with none selected, create fails `ORGANIZATION_REQUIRED` |
| Out-of-scope edit or delete | Answers `COUPON_NOT_FOUND`, not `FORBIDDEN` — never confirms another academy's id exists |
| `appliesTo: []` | All courses in the coupon's own academy; if listed, only those, and foreign course ids are rejected |
| Usage slots | Claimed atomically at order creation, released if checkout fails |
| Currency | Stamped from the academy; percent is neutral, fixed must match the checkout currency |

Two **preview** endpoints — `GET /coupons/validate` (student) and `GET /admin/coupons/validate` — check validity without claiming a slot.

---

## 7. Verification

**Type-checks:** `backend`, `admin`, `client` — all clean.

**Repeatable suites** — the repo had no tests before this; these live in `backend/src/tests/`:

```bash
cd backend && bun run test          # both suites
```

| Suite | Checks | Needs |
|-------|--------|-------|
| `test:security` | **39** — document references, coupon currency, coupon slot leak, Mux signature freshness | nothing (pure logic) |
| `test:2fa` | **37** — full second-factor lifecycle through the real services | a local mongod |
| `test:paths` | **18** — learning-path academy scoping and ownership | a local mongod |
| `test:claims` | **24** — registration timing, token audience + the staged rollout, AI daily allowance | a local mongod |
| `test:impersonation` | **27** — impersonation as a revocable session, through the real app: revoke kills a live token, the kill switch, expiry, and the actor trail | a local mongod |
| `test:permissions` | **22** — custom roles through the real app: an uncapped admin is untouched, a capped one is genuinely restricted across the whole matrix, report/off modes, dangling role, and the escalation guard | a local mongod |
| `test:signup` (extended) | **+3** — a PDF is a valid identity scan but not a valid public profile photo (B-02), and a repeated `kind` field falls back to the private prefix |
| `test:smoke` | **88** — does each panel still do its job? Admin auth, dashboard, staff creation, the full course→section→lesson→quiz lifecycle, coupons, live classes, enrolment approval, student journeys, free enrolment, and 21 malformed-id probes | a local mongod |
| `test:adminmatrix` | **364** — every sidebar section × all 9 roles × both academies, reads and writes, an escalation ladder, cross-tenant probes and 15 malformed-input variants | a local mongod |
| `test:bounty` | **40** — the six bug-bounty findings: per-currency prices stored and driving the charge, courses without them still falling back, clearing a field actually clearing it, cross-academy instructor assignment, header validation, and all five checkout routes agreeing | a local mongod |
| `test:kyc` | **24** — who may read an identity scan: the owner, same-academy staff, nobody else; field and id validation; legacy rows; and the static path refusing `kyc/` in every casing **against a control that proves the path serves anything at all** | a local mongod |
| `test:cookies` | **30** — cookie scope through the real app: host-only issuance, the legacy-scope eviction that avoids a forced sign-out, the shared-scope escape hatch, logout clearing both, and both portals staying independent | a local mongod |
| `test:signup` | **41** — a full signup with no session: the anonymous document endpoint and its bounds, every other upload route still gated, and the whole flow in both default and verification-first mode | a local mongod |
| `test:http` | **24** — the real Express app over a socket: login, session cookies, guard wiring, Zod validation, org threading | a local mongod |

Every DB suite runs against its own **throwaway database** (`lms_2fa_suite`, `lms_lp_suite`, `lms_perm_suite`, `lms_cookie_suite`, `lms_signup_suite`, `lms_kyc_suite`, `lms_http_suite`), drops it on exit, and aborts if it ever finds itself connected anywhere else — the real `lms` data is never opened. Verified: after a full run, no test database remains, and the real `lms` still holds its 38 collections and 79 users.

`signup.suite.ts` additionally blanks the R2 credentials **before** anything reads the env config, so its fixtures go to local disk rather than the production bucket, and it deletes the files it wrote — including any a mutation caused it to store through a route that should have refused.

**778 checks across 13 suites, 0 failures, identical across six consecutive full runs.**

**The HTTP suite exists because the others structurally cannot reach the route layer.** Middleware order, which guard is attached to which route, and whether `organizationId` actually travels from `req.user` into the service are all things that type-check perfectly and pass every service test while being wrong. Several of those wirings were edited in with `sed`.

**The application was also booted end to end** against a throwaway database — connect, seed roles, seed organizations, re-index orders and coupons, run the org and coupon-currency backfills, start cron, listen. Clean, no errors. Worth stating plainly because many of these fixes touch `index.ts`, `app.ts`, `schema.ts` and the auth middleware, where a boot-time failure takes the whole service down and no type-check would catch it.

**Detail of what those cover:**

| What | Cases |
|------|-------|
| Document-reference validator (P-07 / P-19) | 12/12 — `kyc/` keys, legacy URLs, own-storage URLs, and rejection of foreign hosts, traversal, `javascript:`, protocol-relative |
| Coupon currency (N-01) | 11/11 — both cross-currency directions, legacy no-currency row, case-insensitive compare, over-large-value cap |
| Coupon slot leak (N-01 regression) | 2 consecutive mismatched attempts claim **0** slots; the matching attempt claims exactly 1 |
| Mux signature freshness (NEW-02) | 13/13 — fresh, 4-min-old and boundary-exact all accepted; 6-min replay, day-old replay, future-dated, forged HMAC, tampered body, non-numeric `t`, missing `t`/`v1`, absent and garbage headers all refused |
| 2FA lifecycle (NEW-01) | 37/37 end-to-end against a real database — the password gate, enable, the login challenge (password step yields *no* session), single-use challenges, the 5-attempt per-challenge cap, the durable account lockout, disable, and admin reset. TOTP step windows (±1 accepted, ±2 refused) are checked against an **independent** RFC-6238 implementation, not the service's own |

| Learning-path tenancy (P-22) | 18/18 against a real database — create stamps the academy; a different instructor cannot edit; the other academy's admin can neither edit nor delete; its own academy's admin can; super_admin is never scoped; both list paths are filtered; legacy rows with no academy stay reachable and visible |

| HTTP route layer | 24/24 through the real app — a disabled account's cookie stops working mid-session (`ACCOUNT_DISABLED`) and a deleted one is refused (`ACCOUNT_GONE`); 2FA setup without a password is rejected by validation; a student is refused a presigned upload; a `kyc/` key is accepted where only a URL used to be, and a foreign host still is not; a learning path created by one academy cannot be edited or deleted by the other, and the admin list is filtered |

**Ten suites were mutation-tested** — a suite that only ever passes proves nothing. With the password check deliberately removed from `setup()`, checks A1 and A2 fail (`got ok, want WRONG_PASSWORD`); with it restored, 37/37 pass again. A suite that only ever passes proves nothing — this one demonstrably fails when the fix is reverted.

| Mutation | Result |
|----------|--------|
| Password check removed from `TotpService.setup()` | A1, A2 fail — `got ok, want WRONG_PASSWORD` |
| Academy gate removed from `#assertOwned` | 9 failures, naming exactly the cross-tenant cases |
| `requireInstructor` removed from `POST /uploads/presign` | `a student is refused — got 201` |
| `requirePermission` made to always allow (P-10) | 6 failures, incl. `deleting a user is DENIED — got 200` |
| `requirePermission` made to fail **open** on a dangling role (P-10) | `a deleted role denies rather than silently granting everything — got 500` |
| The course-author gate removed (B-07) | 9 failures, incl. `support's published course is NOT on the public catalogue — VISIBLE to anonymous visitors` |
| Learning paths back to the client-only guard (B-09) | `super_admin can load learning paths — 401` |
| Meet-link error handling removed (B-10) | `a Meet-link failure is NOT a generic 500 — 500 INTERNAL_ERROR` |
| Booking date validation removed (B-08) | `admin · bad date range does not 5xx — 500` |
| The base repository stops rejecting malformed ids (B-06) | `DELETE /admin/sections/:bad → 500` |
| Cookies pinned back to the shared apex domain (M-21) | 12 failures, incl. `the access cookie carries NO Domain — domain=.deltainstitutions.com` |
| Legacy-cookie eviction never fires (M-21) | 9 failures — the stale apex pair survives every response |
| Logout stops clearing the legacy pair (M-21) | 2 failures — "sign out" leaves a valid apex cookie behind |
| `/uploads/signup-doc` mounted **below** the auth gate (M-05) | 12 failures, incl. `an anonymous caller can store an identity scan — got 401` |
| The blanket `authenticateAny` removed from the upload router (M-05) | `/uploads/document`, `/uploads/kyc`, `/uploads/image` each **got 201** anonymously |
| `kind` ignored, so everything lands in the public bucket (M-05) | `it returns a bare kyc/ key, never a fetchable URL — http://…/uploads/documents/…png` |
| Magic-byte check dropped from the anonymous endpoint (M-05) | `bytes that do not match the declared type are refused — got 201` |
| Avatar no longer taken from the signup photo (M-05) | 2 failures across both signup modes |
| The `kyc/` static block removed (H-11) | 4 failures — the scan is served, in every casing |
| That block made case-**sensitive** again (P-23) | 2 failures — `/uploads/KYC/…` and `/uploads/Kyc/…` **got 200** |
| Instructors treated as staff again (H-05) | `an instructor is refused` |
| The owner/staff gate removed (H-11) | 3 failures, incl. `another student is refused — got 200` |
| The unknown-field guard removed (H-11) | `an unknown field is rejected — got 404` |
| **Both** tenancy layers removed at once (H-11) | `the other academy's admin is refused — got 200` |
| The profile-photo image allow-list removed (B-02) | `...but refused as a public profile photo — got 201` |
| `priceAED`/`priceINR` removed from the Course schema (B-01) | 6 failures, incl. `admin types INR 999 → Razorpay charges 999, not 8300 — 8300` |
| The controller stops passing the overrides through (B-01) | 5 failures, the same billing consequence |
| The INR rate hardcoded back to `83` (B-01) | `honours INR_EXCHANGE_RATE rather than a hardcoded 83 — rate=90 price=8300` |
| The AED rate hardcoded back to `3.67` (B-01) | `honours UAE_EXCHANGE_RATE — 367` |
| Marking a course free stops clearing its overrides (B-01) | `a "free" course cannot still bill — {"i":2499,"a":199}` |
| `undefined` back into `$set` instead of `$unset` (B-06) | 2 failures, incl. `the level is really gone — beginner` |
| The instructor-assignment guard removed (B-04) | 4 failures, incl. `assigning the other academy's instructor is refused — got 201` |
| Only the academy check removed from that guard (B-04) | 2 failures — existence still checked, tenancy not |
| `X-Organization-Id` trusted without validation (B-05) | `a malformed header is a 400, not a 500 — got 200` |
| The shared checkout guard always allows (B-03) | 5 failures across all five gateways |
| That guard blocks PENDING too — the original Stripe behaviour (B-03) | `a PENDING applicant is still allowed through — got ACCESS_REJECTED` |

That last one is worth its own line: the student's request returned **201**, not merely an un-blocked 403. The presign genuinely succeeded and minted an upload URL — confirming P-15 was a live hole rather than a theoretical one.

**Test flaws found and fixed while building them, none a product bug:**
- **The M-05 timing check was wrong three times, and each wrong version passed for a while before failing.** V1 took 5 samples per path, compared the means, and failed if they differed by more than 80 ms — but the standard error on a 5-sample mean here is ~90 ms, larger than the threshold itself. It was measuring noise, and flaked about one run in three. V2 tried to drown the noise by raising bcrypt to 13 rounds at runtime; that silently did nothing, because `hashPassword()` reads `env.BCRYPT_ROUNDS` and the config parses it **once at import**. The check kept comparing two noisy numbers, passed on a quiet machine, and then failed 3 of 4 runs inside the full suite. **V3 stopped comparing two measurements at all.** The property is not "the two paths take similar time" — that difference is real, small and forever noisy, because the new-email path also writes a user. The property is "the taken-email path pays a full bcrypt hash", and that has a floor: one hash, measured in the same process. But V3 timed the **first** `hashPassword()` call in the process as its yardstick, which pays bcrypt's native-binding load and JIT on top of the real work — 444 ms against a true ~220 ms. An inflated yardstick drags the ratio down, and a correct run failed at 0.48x against the 0.50 floor. The tell was in the number itself: a register cannot cost *less* than the hash it performs, so when it appears to, the baseline is what is wrong.

  **V4 discards the first hash and takes the median of three.** That removes a known systematic bias rather than moving the threshold to accommodate it. Correct code now reads **1.74-3.49x** of a hash across ten consecutive runs — above 1.0, as it should be, since a register is a hash plus a database round trip. Reverting the fix reads **0.03x**. A ~60x separation, scale-invariant, and no longer sensitive to which call in the process gets measured. The gap between the paths is reported for context but never asserted on.
- The 2FA suite tripped the account lockout, because a wrong 2FA code deliberately feeds the same durable counter a wrong password does. Phase **L** now asserts that behaviour explicitly rather than working around it.
- The TOTP window assertions could invert if a 30-second step boundary fell between generating a code and verifying it. The suite now parks at the start of a fresh step.
- Under mutation the learning-path suite **crashed instead of reporting**: a genuinely-succeeding cross-academy DELETE removed the fixture, and a later bare `await` threw. Every step after phase C is now wrapped, so a regression is reported rather than fatal.
- `learningpath.suite.ts` reaches its dependencies through dynamic `import()` (so `process.env` is set first), leaving no static import or export — which made `tsc` treat it as a script and reject top-level `await`. An empty `export {}` restores module status.
- **The DB suites left stray databases behind.** `dropDatabase()` ran, but mongoose builds indexes asynchronously and those builds raced the teardown, recreating empty collection shells afterwards. Diagnosed by counting documents (0 — index shells, not data) rather than assuming. `mongoose.set('autoIndex', false)` in each suite removes the race; verified that a full run now leaves nothing behind.
- **A verification script reported writing when it had written nothing.** `migrate-kyc --clear-missing` used `delete subdoc.field` on `enrollmentApplication`, which is a nested Schema — assignment goes through Mongoose's setter and is tracked, but `delete` mutates nothing the change tracker can see. It printed "Cleared 2" while both values stayed in the database. Caught only by re-reading the collection afterwards rather than trusting the summary. Now uses `$unset` and checks `modifiedCount`.
- **Several of my own verification commands were silently lying.** `bun run type-check 2>&1 | tail -6 && echo OK` prints OK whatever `tsc` returns, because `tail` succeeds regardless. That is how a real type error in a test file passed a check I had already called green. Every verification now captures the actual exit code.

**Every fix re-verified against the working tree** — 36/36 checks, each locating the actual guard, error code or call-site rather than trusting an earlier note.

> Two earlier "verified" sweeps produced false failures from bugs in the *check script* (a mis-escaped regex; a `grep -c` counting lines rather than occurrences). Both were confirmed correct by direct inspection. The final sweep matches on fixed strings for this reason.

### What this does *not* cover

- **No end-to-end run.** The payment fixes are verified by code reading, type-check and unit-level tests — **not** by a real transaction. Before deploying, smoke-test one real Abzer and one real Tamara checkout: both now **fail closed** where they previously always succeeded.
- **P-07 / P-08** are verified by validator tests and type-check, not by an upload through a running stack.
- **The full signup form could not be click-tested, for a reason worth knowing.** On the running client, clicking the **Full Registration** tab does not switch the form: the Express form stays on screen, there are zero file inputs in the DOM, and the step indicator still reads "Step 1 of 2". Verified after a hard reload, with the button enabled, hit-testable and throwing no console errors. This is **pre-existing and unrelated** — `git diff` shows no change anywhere near that tab (RegisterForm.tsx:1710-1900); the M-05 edit touches only `submit()`. It does mean the full enrolment flow is currently unreachable in the UI regardless of this work, and it should be fixed before relying on any of it.
- **NEW-01's client UI was not click-tested.** The backend gate has unit coverage and all three packages type-check, but the new password prompt in the 2FA panel has not been exercised in a browser. Worth one manual pass through Settings → Two-factor authentication before release. (`npm run lint` is not configured in this repo — it prompts interactively — so type-check is the only automated gate on that file.)
- **N-06 / H-11** cannot be confirmed from the repository — whether the KYC bucket is genuinely private, and whether the migration has run, has to be checked in the Cloudflare console.

---

## 8. Deployment sequence

**Before deploying**
1. **Commit the working tree.** Still 0 commits ahead of `main`.
2. Register `ABZER_WEBHOOK_SECRET` in the Abzer console for production — P-01's fulfilment path depends on it.
3. Move `TAMARA_BASE_URL` off `api-sandbox.tamara.co` — P-02 refuses fulfilment on a failed authorise, and every sandbox authorise fails.
4. Audit live fixed-amount coupons: confirm each `discountValue` reads correctly as its academy's currency. The backfill assigns the academy's currency, so a coupon created in the *other* academy's scale is now wrong in a new way.

**At deploy**
5. Watch for `ACCOUNT_GONE` / `ACCOUNT_DISABLED` 401s (P-06) — expected for genuinely revoked accounts, unexpected otherwise.
6. Watch for the boot log `Coupon currency backfill: stamped N coupon(s)`, and for the error naming any fixed coupon left without a currency.
7. Smoke-test one real Abzer and one real Tamara checkout.

**Shortly after**
8. Set `RAZORPAY_WEBHOOK_SECRET`; confirm `ABZER_WEBHOOK_SECRET` in production.
9. Generate `PROXY_SHARED_SECRET` (same value in all three `.env` files), then raise `RATE_LIMIT_API_MAX` — 100/min was crippling shared platform-wide and is generous per person.
10. Step `JWT_ACCESS_EXPIRES_IN` 1h → 15m.
11. Finish N-06: confirm the KYC bucket has public access disabled, run `bun run migrate-kyc` then `--apply`, verify the signed links, delete the old `documents/` objects.

**When you have decided**
12. Set `PROXY_SHARED_SECRET` in the production environment for **all three** apps — the same value in each. It is in the local `.env` files but those are gitignored, and a mismatch means the relay header is ignored and rate limiting silently falls back to one shared bucket.
13. Confirm public access is disabled on `lms-delta-kyc`, then re-run `bun run verify-kyc` — it should stay green.

**Optional, B-01** — set `INR_EXCHANGE_RATE` and `UAE_EXCHANGE_RATE` to today's rates if the defaults (83 / 3.67) have drifted. They govern every course that has no per-currency price, which is all of them until an admin sets one.

**Optional, B-03** — `CHECKOUT_BLOCK_REJECTED=true` makes an admin's rejection final across all five gateways. Off by default, which is what four of the five did already.
14. Nothing further on dependencies. 14 of 15 advisories are closed by `overrides`; `next@16` is not needed. The remaining one is a nested `qs@6.15.1` that Bun's overrides cannot reach — its vulnerable function is `stringify`, which this codebase never calls (see §1). Fix the **Full Registration tab** first (see §5): the full enrolment form is currently unreachable in the UI, and that is independent of everything here.

**Nothing to configure for M-21.** Host-only cookies are the default and `LEGACY_COOKIE_DOMAIN` already defaults to the apex value sitting in production browsers, so the eviction happens on its own. Set `COOKIE_DOMAIN` only if the apps are ever split across hosts that must share one session. **Do not** blank `LEGACY_COOKIE_DOMAIN` before deploying — that is what stops the stale apex pair from tripping refresh-token reuse detection.

**Optional, M-05** — `SIGNUP_REQUIRE_VERIFICATION=true` is now safe. It costs a mail round trip before a new user can browse, so it stays off until you want that trade.

**Optional, P-10** — the matrix ships **enforcing**, which is a no-op today (0 of 79 accounts carry a custom role). If you would rather watch before it bites, set `PERMISSIONS_MODE=report` for a week: every would-be denial is logged, nothing is blocked. Leaving it unset is the enforcing default and is safe as things stand.

---

## 9. Appendix — closed findings

### From the 2026-08-05 audit *(closed in remediation round 1, re-verified 2026-08-07)*

**Critical (2)** — C-01 payment webhooks fail open · C-02 default seed credentials

**High (21)** — H-01 webhook NoSQL smuggling · H-02 TOTP never verified at login · H-03 cross-tenant course/section/lesson CRUD · H-04 cross-academy user administration · H-05 instructor KYC access · H-06 Mux stream key exposure · H-07 instructors could manage any live class · H-08 arbitrary R2 delete · H-09 live-class join-URL leak · H-10 presign prefix/Content-Type · H-11 KYC documents served unauthenticated *(operational step outstanding — N-06)* · H-12 audit trail not tenant-scoped · H-13 admin login throttling · H-14 cross-tenant bulk delete · H-15 cross-tenant refund · H-16 support ticket isolation · H-17 transcript ownership · H-18 outline permission · H-19 grading ownership · H-20 cross-org enrollment · H-21 transcoder memory

**Medium (25)** — M-01 password change revocation · M-02 non-revocable 7-day access tokens *(staged at 1h)* · M-06 upload MIME verification · M-07 coupon `maxUses` race · M-08 coupons not org-scoped · M-09 seat oversell race · M-10 booking decrement race · M-11 rate limiters keyed on the proxy *(inert until `PROXY_SHARED_SECRET` is set)* · M-12 module gating coverage · M-13 quiz attempts/enrolment · M-14 quiz question access · M-15 transcript access · M-16 homework IDOR · M-17 AI content exfiltration · M-18 email HTML injection · M-19 `$regex` ReDoS · M-20 mass assignment · **M-21 apex-scoped session cookies** *(closed 2026-08-08, no sign-out required)* · M-22 `0.0.0.0` bind · M-23 `DISABLE_RATE_LIMIT` gating · M-24 ticket message bound · M-25 email limiter · M-26 `sharp` CVEs · M-27 `next` image optimizer CVE · M-28 `multer` DoS
*(M-26 / M-27 / M-28 were re-opened by P-09 — the declared ranges had been raised but the installed tree still resolved to affected versions. Now genuinely closed except for the `next@16`-gated three.)*

**Low (11)** — L-01 tracked email logs · L-02 open redirect · L-03 no-op mobile logout · L-04 health-endpoint leak · L-05 unregistered error classes · L-07 `adminRefresh` role check · L-08 unauthenticated AI notes · L-11 stale `.tmp` in git · L-12 non-constant-time compare · L-13 inverted audit-log privilege · L-14 mentor availability access *(student case closed then; staff case closed by P-17)*

**Found and fixed during round 1 (10)** — N-02 cross-tenant coupon edit/delete · N-03 coupon slots stranded by failed checkouts · N-04 deleted account retained cross-academy authoring rights *(general case closed by P-06)* · N-05 unvalidated rate-limit relay header · N-06 a prefix does not gate a public R2 bucket *(code fixed; operational step outstanding)* · N-07 `authenticateAny` leaves `organizationId` unset *(residual gap closed by P-06)* · N-08 impersonation inherited the session TTL · N-09 a malformed TTL crashed every login · N-10 course owner inherited control of colleagues' sessions · N-11 live classes had no tenancy check for admins

### Re-verified clean during the 2026-08-07 pass

Read end to end, no findings: password and 2FA handling (constant-time dummy hash, account lockout, single-use challenges, refresh rotation with reuse detection) · email templates (every user value through `escapeHtml`, every link through `sanitiseUrl`) · NoSQL injection surfaces (every `$regex` escaped and length-capped, webhook identifiers through `asString()`, no `$where`) · quiz integrity (enrolment asserted, 5-attempt cap, answer key withheld on failure) · booking concurrency (`$expr`-guarded atomic seat reservation with rollback on every branch) · coupon tenancy · transcripts, notes, bookmarks, certificates, feedback, favourites · `documents.routes.ts` · secrets hygiene (no tracked `.env`, no credential literals) · `hls.service.ts` (no shell-injection path) · frontends (one `dangerouslySetInnerHTML`, rendering a static font constant; no token in `localStorage`; both middlewares gate correctly; the `?sso=` parameter has no consumer — a dead comment, not a bypass).

**False positives from the original audit** remain excluded.
