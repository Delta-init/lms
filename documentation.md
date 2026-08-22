# Delta LMS — Project Documentation

A full-stack Learning Management System for Delta Digital Academy. The repository is a
monorepo containing three independent sub-projects: a REST API backend, an admin
dashboard, and a student-facing client app.

> Timezone: the **backend** runs on UAE time (Asia/Dubai, UTC+4) — cron
> schedules, day-boundary math, and email date labels assume it; storage is UTC.
> The **admin panel** displays the active academy's zone (Dubai → Asia/Dubai,
> Bangalore → Asia/Kolkata). The **client** displays the student's device time.

---

## 1. Repository layout

| Directory | Role | Stack | Default port | Package manager |
|-----------|------|-------|--------------|-----------------|
| `backend/` | REST API | Express 4 + **Bun** + MongoDB (Mongoose) | 8000 | **Bun** |
| `admin/` | Admin dashboard | Next.js 15 (App Router) + React 19 | 3001 (3002 in preview) | npm |
| `client/` | Student app | Next.js 15 (App Router) + React 19 | 3000 (3003 in preview) | npm |

Supporting files at the root:

- `README.md` — original repo readme.
- `project.md`, `project-mistakes.md`, `design.md`, `memory.md` — working notes.
- `design-system/`, `docs/` — design assets and additional docs.
- `.claude/launch.json` — preview server config (admin → 3002, client → 3003).

---

## 2. Getting started

### Prerequisites
- [Bun](https://bun.sh) (backend runtime & package manager)
- Node.js 20+ and npm (for `admin/` and `client/`)
- MongoDB instance (local or hosted)

### Install & run

```bash
# Backend
cd backend
bun install
bun run dev          # watch mode on :8000
bun run seed         # wipe + re-seed the database
bun run type-check   # tsc --noEmit

# Admin dashboard
cd admin
npm install
npm run dev          # next dev on :3001
npm run build
npm run lint
npm run type-check

# Client (student app)
cd client
npm install
npm run dev          # next dev on :3000
npm run build
```

> **Never run `npm` in `backend/`** — it uses Bun. Never run `bun` in `admin/`/`client/`.

### Useful backend scripts (`backend/src/scripts/`)
- `seed.ts` — `bun run seed`, wipes and re-seeds the DB.
- `create-super-admin.ts` — bootstrap a super-admin account.
- `get-google-token.ts` — obtain a Google OAuth token (Google Meet integration).

---

## 3. Environment variables

```bash
# backend/.env
PORT=8000
MONGODB_URI=
JWT_SECRET=
CLIENT_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001

# client/.env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000

# admin/.env  (same pattern)
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Additional backend integrations read their keys from `backend/.env`: MongoDB, JWT,
S3/R2 storage, Mux (video), Razorpay & Stripe (payments), Nodemailer (email),
Google APIs (Meet), Ollama (AI), and Sentry. See `backend/src/config/env.ts` for the
full validated schema.

On every boot the backend runs two idempotent migrations:
1. `seedDefaultRoles()` — ensures system roles exist.
2. Backfills `enrollmentStatus` on legacy `student` accounts that predate the field.

---

## 4. Architecture

### 4.1 API contract

All routes are prefixed **`/api/v1`**. Both Next.js apps proxy `/api/v1/*` → backend,
so frontend code never hardcodes the backend URL. Every response uses this envelope:

```jsonc
// success
{ "success": true,  "data": <payload>, "meta": <pagination?> }
// failure
{ "success": false, "error": { "code": "SNAKE_CASE_ERROR", "message": "human string" } }
```

Health/readiness probes:
- `GET /api/v1/health` — liveness (always 200 when up).
- `GET /api/v1/ready` — 200 only when the MongoDB connection is open (503 otherwise).

### 4.2 Authentication — two independent sessions

| Cookie | Used by | Middleware |
|--------|---------|------------|
| `lms_at` | student client | `authenticate()` |
| `lms_admin_at` | admin dashboard | `authenticateAdmin()` |

Both are **httpOnly, 15-minute** access tokens paired with **30-day refresh tokens**
stored **hashed** in MongoDB. Reuse detection: any reused refresh token invalidates
**all** sessions for that user.

Key middleware in `backend/src/middleware/auth.middleware.ts`:
- `authenticate` / `authenticateAdmin` — populate `req.user`.
- `requireRole(...roles)` — 403 if the role isn't listed.
- `requireEnrollmentApproval` — blocks `pending`/`rejected` students from guarded routes.
- Convenience exports: `requireAdmin`, `requireAnyAdmin`, `requireInstructor`.

TOTP-based 2FA is available (`totp.routes.ts` / `totp.service.ts`).

### 4.3 Student enrollment state machine

```
signup           → enrollmentStatus: 'pending'   (viewer — browse only, no bookings)
admin approve    → 'approved'                     (student — full access)
admin reject     → 'rejected'                     (viewer — browse only)
admin block      → isActive: false                (login disabled entirely)
```

### 4.4 CORS

Allowed origins live in `backend/src/config/cors.ts`: `env.CLIENT_URL`,
`env.ADMIN_URL`, `http://localhost:3002`, `http://localhost:3003`.
**Add new preview ports here when needed.**

### 4.5 Timezone

`backend/src/config/timezone.ts` must be the **first** import in
`backend/src/index.ts` — it sets `process.env.TZ = 'Asia/Dubai'` before any `Date`
object is created. Do not reorder it.

Frontend display zones (added Aug 2026):
- **Admin** formats every date/time in the active academy's zone — Dubai →
  `Asia/Dubai`, Bangalore → `Asia/Kolkata`. `TimezoneScope`
  (`admin/src/app/providers.tsx`) resolves it: super admins follow the topbar
  org switcher ("All Orgs" → Dubai); scoped admins/instructors get their own
  academy via `/admin/my-organization`. The `<input type="datetime-local">`
  helpers in `admin/src/lib/timezone.ts` convert academy wall-clock ↔ UTC, so a
  Bangalore admin schedules classes in IST.
- **Client** formats in the student's **device timezone** (what calendar apps
  do; correct for travellers, no profile data needed). Class times, day
  grouping, and Today/Tomorrow labels all follow the student's clock.
- Known follow-up: backend **email** date labels are still rendered in Dubai
  time for all recipients.

---

## 5. Backend structure (`backend/src/`)

```
config/       env, database, cors, timezone
middleware/   auth, error, rateLimit, upload, validate, audit
models/       schema.ts (all Mongoose models), types.ts
repositories/ data-access layer
services/     business logic (one file per domain)
controllers/  request handlers
routes/       Express routers, wired together in routes/index.ts
jobs/         cron jobs (reminders.job.ts)
scripts/      seed, create-super-admin, get-google-token
utils/        helpers
```

Request flow: **route → validate middleware → controller → service → repository → model**.

### 5.1 Data models (`models/schema.ts`)

User, Role, RefreshToken, AuthToken, Category, Course, Section, Lesson, Enrollment,
LessonProgress, Review, ReviewVote, Notification, Favorite, LiveClass, Quiz,
QuizAttempt, Assignment, AssignmentSubmission, UserAchievement, UserStreak, Coupon,
Order, DiscussionThread, DiscussionComment, LessonNote, VideoBookmark, LearningPath,
AuditLog, MentorAvailability, ClassBooking (and more).

### 5.2 API domains (mounted under `/api/v1`)

`/auth` · `/courses` · `/categories` · `/enrollments` · `/lessons` · `/reviews` ·
`/admin` · `/live-classes` · `/notifications` · `/favorites` · `/achievements` ·
`/quizzes` · `/assignments` · `/certificates` · `/streaks` · `/coupons` · `/checkout` ·
`/webhooks` · `/orders` · `/learning-paths` · `/ai` · `/audit-logs` · `/uploads` ·
`/bookings` · `/feedback` · `/support` · `/instructors`
(discussion, notes, and bookmark routes are nested under `/lessons` and `/threads`).

### 5.3 Notable services
- **Payments**: `razorpay.service.ts`, `stripe.service.ts`, `order.service.ts`.
  Gateway routing (`OrderService.getGatewayConfig`, keyed on the registration
  form's Country of Residence): **Middle East residents → Abzer, AED** (Tamara/
  Tabby BNPL additionally for UAE only); **everyone else → Razorpay, INR**.
  The country set lives in `OrderService.MIDDLE_EAST_COUNTRIES` and must match
  the client CountryPicker spellings.
  **Price display follows the checkout currency**: public course payloads carry
  backend-resolved `priceAED`/`priceINR` (override or USD × rate), and the
  client (`client/src/lib/coursePrice.ts`) labels courses/cart in the currency
  the student's gateway will charge. Admin endpoints keep the raw overrides —
  do not resolve there (the course form would save conversions back as
  explicit prices).
- **Video**: `mux.service.ts`, `hls.service.ts` (internal streams).
- **Live classes**: `liveClass.service.ts`, `googleMeet.service.ts`.
- **Storage**: `r2.service.ts` (S3/R2) with local-disk fallback.
- **AI**: `ai.service.ts`, `aiNotes.service.ts`, `transcript.service.ts` (Ollama).
- **Messaging**: `email.service.ts` (Nodemailer), `whatsapp.service.ts`.

---

## 6. Domain rules & known quirks

- **Programs**: four program categories exist — `4x-trading` (FOREX),
  `digital-marketing`, `ai`, and `jura` (JURA, added Aug 2026). The sub-admin
  `User.program` values are `forex | digital_marketing | ai | jura`
  (`injectCategoryScope` maps them to the category slugs). Adding another
  program means extending the enum/label maps in all three apps — grep for
  `4x-trading` to find every touchpoint.

- **`Enrollment.blockedLessons[]` stores section/module IDs, not lesson IDs** — legacy
  misnomer. The booking route checks `session.sectionId` against this array to enforce
  module-level access.
- **Live class types**: `LiveClass.type` is `'external'` (Zoom/Meet link) or
  `'internal'` (Mux stream). A separate boolean `isOnline: false` marks **in-person**
  classes, which also carry `location` and `room`. Module-blocking applies to both.
- **File uploads**: served at `/uploads/images/:file` and `/uploads/videos/:file`
  without auth. Filenames are random hex, so URLs are unguessable.
- **R2 bucket CORS is required for video uploads.** Images go
  browser → backend → R2 (same-origin), but videos go browser → R2 **directly**
  via a presigned PUT, which the browser preflights. A bucket with no CORS
  policy answers the `OPTIONS` with **403** and video uploads fail while image
  uploads keep working. Fix/provision with
  `bun src/scripts/setup-r2-cors.ts` (idempotent; `--dry-run` to inspect).
  The KYC bucket is intentionally excluded.
- **Form validation**: Backend uses Zod → `validate(schema)` per route. Frontend uses
  React Hook Form + Zod resolver. Direct DOM `input.value = x` does **not** update RHF
  state — always use the registered `onChange` or `setValue`.
- **Forensic video watermark**: every in-app player (Vidstack lessons, Mux live/
  recordings) renders `client/src/components/video/WatermarkOverlay.tsx` — a fixed
  faint company mark plus the viewer's email · phone drifting between edge zones
  every 7 s (`pointer-events: none`, ~35 % opacity). It must live INSIDE the
  element that enters fullscreen (Vidstack: a `<MediaPlayer>` child; Mux: the
  `WatermarkedFrame` wrapper, whose own button drives fullscreen because the
  player's native one is hidden via `--fullscreen-button: none`). Deters class
  sharing: any screen-recorded leak carries the leaker's identity.
  A tamper guard (1.5 s interval + the video's own `timeupdate` events) pauses
  playback and self-heals whenever the overlay is deleted, hidden, or its text
  altered — "inspect → delete node" now means the tag reappears and the video
  stops. Only patching the app's JS itself bypasses it.

---

## 7. Frontend conventions (admin & client)

- **Next.js 15 App Router**, React 19, Tailwind CSS, Framer Motion, Zustand.
- **Data fetching**: TanStack React Query + Axios (`src/lib/axios.ts` proxies to backend).
- **React Query cache namespacing** (prevents collisions if both apps share a tab):
  - client keys: `['courses', ...]`
  - admin keys: `['admin', 'courses', ...]`
  - Follow this pattern for every new query key.
- **API clients** live in `src/lib/api/*` per domain (e.g. `instructors.ts`, `support.ts`).
- Shared UI primitives in `src/components/ui/` (Spinner, PageLoader, FlickerSpinner, etc.).

---

## 8. Git workflow

This repo has **multiple contributors** — always sync before starting work:

```bash
git status && git branch --show-current
git fetch --all --prune
git log --oneline -5
git log --oneline -5 "origin/$(git branch --show-current)"
# clean + behind  → git pull --ff-only
# dirty or diverged → STOP and resolve deliberately
```

Never `git push --force`, `git reset --hard`, or delete branches without confirmation.
The default working branch is `main`.

---

## 9. Preview / verification

`.claude/launch.json` starts **admin on 3002** and **client on 3003** (not the default
3001/3000). The **backend is not** in launch.json — start it separately with
`bun run dev` from `backend/`. Remember to whitelist any new preview port in
`backend/src/config/cors.ts`.
