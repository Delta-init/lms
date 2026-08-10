# LMS

A learning-management system in three apps, sharing a design system:

| App            | Stack                                  | Port | Purpose                            |
|----------------|----------------------------------------|------|------------------------------------|
| `backend/`     | Bun · Express · Mongoose · MongoDB     | 4000 | REST API at `/api/v1`              |
| `client/`      | Next.js 15 · React 19 · Tailwind       | 3000 | Student-facing app                 |
| `admin/`       | Next.js 15 · React 19 · Tailwind       | 3001 | Admin dashboard                    |
| `design-system/` | CSS tokens · Tailwind preset · Framer | —    | Tokens, fonts, animation presets   |

## Prerequisites

- **Bun** for the backend (`curl -fsSL https://bun.sh/install | bash`)
- **Node 20+** + **npm** for the two frontends
- **MongoDB** running locally on `27017`, or a connection string for Atlas

## First-time setup

```bash
# Backend
cd backend
cp .env.example .env             # fill in JWT secrets — both must be 32+ chars
bun install
bun run seed                     # wipes DB, creates 10 courses, 1 admin, 2 instructors

# Frontends
cd ../client && npm install
cd ../admin  && npm install
```

`bun run seed` creates local development accounts. The credentials it uses are defined in
`backend/src/scripts/seed.ts` — they are for local development only and must never exist in a
deployed environment.

To bootstrap a real super-admin, supply the credentials via the environment:

```bash
SUPERADMIN_EMAIL=you@example.com \
SUPERADMIN_PASSWORD='<a long, unique password>' \
bun src/scripts/create-super-admin.ts
```

## Running

Open three terminals:

```bash
cd backend && bun run dev        # http://localhost:4000
cd client  && npm run dev        # http://localhost:3000
cd admin   && npm run dev        # http://localhost:3001
```

The client proxies `/api/v1/*` → backend via `next.config.ts` rewrites; the admin calls the backend directly using `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:4000/api/v1`).

## Architecture

```
backend/src/
├── app.ts            # Express middleware pipeline (cors, cookies, security headers)
├── index.ts          # Bootstrap — Mongo, server, graceful shutdown
├── config/           # env (Zod-validated), cors, database
├── middleware/       # auth, validate, rateLimit, error
├── models/schema.ts  # All Mongoose schemas + transforms
├── repositories/     # Typed DB access (BaseRepository + domain repos)
├── services/         # Business logic, domain error classes
├── controllers/      # Thin HTTP layer — delegates to services
├── routes/           # Route definitions + Zod validators
├── utils/            # jwt, hash, response, authCookies, courseDTO, logger
└── scripts/seed.ts   # `bun run seed` — populates the DB
```

Both Next.js apps use:
- **TanStack Query** for server state (`staleTime: 30s`, `retry: 1`)
- **Zustand** for ephemeral UI state (sidebar, mobile nav)
- **react-hook-form + Zod** for forms
- **Framer Motion** for transitions
- **Lucide React** for icons

## Auth model

JWT-based, but tokens never leave the server unencrypted:

- `POST /auth/login` or `/auth/register` sets two httpOnly cookies:
  - `lms_at` — access token, ~15m, `Path=/`
  - `lms_rt` — refresh token, 30d, `Path=/api/v1/auth` (narrow scope)
- The browser attaches them automatically (`withCredentials: true` on both frontends)
- `POST /auth/refresh` rotates the pair atomically; **reuse of an old refresh token invalidates every session for that user**
- `POST /auth/logout` revokes the current refresh token and clears both cookies
- `POST /auth/logout-all` revokes every refresh token for the user

## API surface (v1)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST   | `/auth/register`          | —     | Sets cookies on success |
| POST   | `/auth/login`             | —     | Sets cookies on success |
| POST   | `/auth/refresh`           | rt cookie | Rotation + reuse detection |
| POST   | `/auth/logout`            | rt cookie | Clears cookies |
| POST   | `/auth/logout-all`        | yes   | Revokes every session |
| GET    | `/auth/me`                | yes   | |
| GET    | `/categories`             | —     | All categories, sorted |
| GET    | `/courses`                | —     | Paginated. `?search&level&category&free&sort&page&per_page` |
| GET    | `/courses/:slug`          | —     | Course + sections + lessons |
| GET    | `/courses/:slug/progress` | yes   | Enrollment + completed lesson ids |
| GET    | `/courses/:id/reviews`    | —     | Paginated |
| POST   | `/courses/:id/reviews`    | yes   | Must be enrolled. Upsert one per (user, course) |
| POST   | `/enrollments`            | yes   | `{ courseId }`. Free courses only. `402` for paid. |
| GET    | `/enrollments/me`         | yes   | All enrollments, populated with course |
| POST   | `/lessons/:id/complete`   | yes   | Recomputes course progress |
| POST   | `/lessons/:id/watch-time` | yes   | `{ secs }`, throttled to ≤300s/call |
| DELETE | `/reviews/:id`            | yes   | Owner only |

All endpoints return `{ success: true, data, meta? }` or `{ success: false, error: { code, message, details? } }`.

## Scope notes

- **Storage is URL-only.** Lessons hold a `contentUrl`; file uploads are out of scope.
- **Payments are not implemented.** Paid courses return `402` from `POST /enrollments`; the UI hides the button.
- **Instructor authoring is not implemented.** Course content comes from `bun run seed`.
- **Quizzes / certificates** are not implemented.


