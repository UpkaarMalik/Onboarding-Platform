# Onboarding Platform

Employee-onboarding portal for AND Payments: HR creates a joinee, the joinee walks a serpentine task trail (document uploads, policy read-throughs, form fills), and HR watches the pipeline in one dashboard. Two clients (HR/SuperAdmin, Employee, Task Owner) share one NestJS API and one React app.

---

## Stack

- **Backend** — NestJS 10, Passport (JWT + custom cookie strategy), raw SQL migrations against Postgres 16, bcrypt for passwords, cookie-parser for auth cookies.
- **Frontend** — React 18 + Vite + TypeScript, React Router, no state library (a single `AuthContext`).
- **DB** — Postgres 16 in Docker (`onboard-postgres` container, `onboarding_db` database, migrations 0001–0029).
- **Auth transport** — HttpOnly cookies (access + refresh + CSRF), see [Session management](#session-management).

## Repository layout

```
backend/
  src/                     NestJS modules — auth/, users/, onboardings/, documents/, ...
  migrations/              Numbered raw-SQL files, applied by scripts/migrate.ts
  scripts/migrate.ts       Minimal migration runner (transaction per file, tracked in schema_migrations)
frontend/
  src/
    api/                   Cookie-authenticated fetch layer with a 401 refresh interceptor
    auth/                  AuthContext + ProtectedRoute
    pages/                 One file per top-level route
    components/            Shared UI (Layout, Modal, TaskRoadmap, ...)
docker-compose.yml         Postgres only. No Redis in this project.
```

---

## Getting started

### Prerequisites

- Docker (for Postgres)
- Node 20+
- `npm`

### One-time setup

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Backend deps + env + migrations
cd backend
cp .env.example .env               # then edit as needed
npm install
npm run migrate                    # applies every SQL file in migrations/

# 3. Frontend deps
cd ../frontend
npm install
```

### Running

```bash
# backend on :3000
cd backend && npm run start:dev

# frontend on :5173 (in another shell)
cd frontend && npm run dev
```

Open http://localhost:5173.

### Bootstrap credentials

The first migration seeds one SuperAdmin HR — see `backend/migrations/0004_seed_bootstrap_superadmin.sql` for the joinee ID and default password. Log in, use *Create New Joinee* to make more accounts.

---

## Auth

Two login methods, both landing at the same session:

- **Mobile OTP** — user enters a phone number, receives a 6-digit code (in dev the code is fixed to `123456` when `AUTH_FIXED_OTP=true` — the value is logged loudly at every boot so it can't sneak into prod).
- **Joinee ID + password** — HR issues a one-time password at account creation; first login forces a reset via a pre-auth JWT.

Roles: `superadmin_hr`, `task_owner`, `employee`. Enforced by `RolesGuard` reading `role` off the access token.

## Session management

**Server-side, DB-backed, HttpOnly cookies.** The backend is the source of truth for who is signed in; the browser never sees the raw tokens.

### On login

1. `AuthService.issueTokens` inserts a `user_sessions` row (see migration `0029_user_sessions.sql`).
2. `AuthController.finalizeLoginResult` sets three cookies on the response:
   - `access_token` — HttpOnly, 15 min JWT carrying `sub`, `role`, `departmentId`, `sid`.
   - `refresh_token` — HttpOnly, opaque 48-byte random string (sha256'd in the DB). Lifetime = the session's `absolute_expires_at`.
   - `csrf_token` — non-HttpOnly, opaque 32-byte random string, same lifetime as `refresh_token`. Frontend echoes it in `X-CSRF-Token` on every state-changing request (double-submit pattern; see [CsrfGuard](backend/src/auth/guards/csrf.guard.ts)).
3. Response body carries only `{status, user, absoluteExpiresAt, idleExpiresAt}`.

### On every authed request

- `JwtStrategy` reads the access cookie, verifies the signature, then calls `SessionsService.findLiveSessionById(sid)` — a session that has been revoked or has aged past its absolute cap returns 401 immediately, even if the JWT hasn't expired.
- `CsrfGuard` runs globally on POST/PUT/PATCH/DELETE, rejecting requests where the `X-CSRF-Token` header doesn't match the `csrf_token` cookie. Login/refresh endpoints opt out with `@SkipCsrf()`.

### On refresh (`POST /auth/refresh`)

`SessionsService.rotateSession` runs a single atomic `UPDATE`:

- WHERE the hashed refresh token matches, `revoked_at IS NULL`, and both `idle_expires_at` / `absolute_expires_at` are in the future.
- SET a fresh `refresh_token_hash`, `csrf_token_hash`, and push `idle_expires_at` forward.

A miss returns null → controller clears the cookies and returns 401 → frontend interceptor calls `redirectToLoginOnce()` → the user lands on `/login?returnTo=<previous URL>`. Same code path fires on session timeout (idle or absolute), on logout, and on password-reset revocation.

### On logout (`POST /auth/logout`)

Revokes only the caller's *current* session (`revoke_reason = 'user_logout'`), clears the three cookies. Idempotent — a repeat call still returns 204 and still clears cookies. "Logout from all devices" is intentionally not exposed as a user endpoint at this time.

### On password reset

`AuthService.completePasswordReset` calls `SessionsService.revokeAllForUser` before responding. Every device signed in under that user is bounced to login on its next request. Reason: `password_reset`.

### Timeouts (all env-tunable in [backend/.env](backend/.env))

- `SESSION_ABSOLUTE_TTL_MS` — hard cap on a session's lifetime. Default 7 days.
- `SESSION_IDLE_TTL_MS` — sliding cap, pushed forward on every refresh. Default 24 hours.
- `JWT_ACCESS_EXPIRES_IN` — access-token TTL. Default 15 min.


## Company policies

Renders from the `documents` table, filtered per-user by department (company-wide docs have `department_id IS NULL`). HR uploads via the *Upload New Policy* button on the Policies page; the backend stores the PDF under `backend/uploads/` and inserts one `documents` row.

The frontend recognises four canonical titles and renders a hard-coded modal breakdown for each — see `POLICY_CONTENT` in [frontend/src/pages/Documents.tsx](frontend/src/pages/Documents.tsx):

- Group Health Insurance
- Domestic Travel Policy
- Meal Reimbursement Policy
- Employee Handbook

Other titles show the raw PDF with a generic description.

## Journey trail

Employees see their onboarding steps as a serpentine trail with the AND Payments boomerang mark sailing from step to step (see [frontend/src/components/TaskRoadmap.tsx](frontend/src/components/TaskRoadmap.tsx)). A sparkle appears at the tail tip when the mark moors on the current step.

---

## Migrations

Numbered `.sql` files in [backend/migrations/](backend/migrations/), applied in filename order, one transaction per file, tracked in `schema_migrations`. Never edit an applied migration — add a new numbered file. Runner: [backend/scripts/migrate.ts](backend/scripts/migrate.ts).

```bash
cd backend && npm run migrate
```

## Environment variables

See [backend/.env.example](backend/.env.example) for the full list. Highlights:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `JWT_ACCESS_SECRET` / `JWT_ACCESS_EXPIRES_IN` | Access token signing + TTL. |
| `JWT_PREAUTH_SECRET` / `JWT_PREAUTH_EXPIRES_IN` | Pre-auth JWT for OTP-verify / password-reset. |
| `SESSION_ABSOLUTE_TTL_MS` / `SESSION_IDLE_TTL_MS` | Session store timeouts. |
| `CORS_ORIGIN` | Comma-separated list of allowed origins (required for cookie CORS). |
| `COOKIE_SAMESITE` | `lax` (default), `strict`, or `none`. |
| `COOKIE_SECURE` | Force HTTPS-only cookies. Defaults to `NODE_ENV === 'production'`. |
| `AUTH_FIXED_OTP` | Dev-only: every OTP is `123456`. Ignored in production. |
