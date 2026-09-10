# Onboarding Platform — Frontend

React + Vite + TypeScript, built against the NestJS backend's actual
API contract (steps 1–37 of the build plan). No admin-panel or
workflow-engine UI library — hand-built, matching the backend's own
"no workflow-engine or admin-panel library" constraint.

## Setup

```bash
npm install
cp .env.example .env   # edit if your backend runs somewhere other than :3000
npm run dev
```

Requires the backend running (default `http://localhost:3000`) with
migrations applied and the bootstrap superadmin seeded (see the
backend's own migrations/0004_seed_bootstrap_superadmin.sql — login
with `bootstrap.admin@id.onboarding.internal` / `Bootstrap#2026Seed`
the first time to get a real SuperAdmin/HR account, then use "Add
Joiner" from the HR dashboard to create employees and task owners).

## What's here

- **Login** (`src/pages/Login.tsx`) — the full multi-step login state
  machine: password → forced reset → TOTP enrollment/verification,
  mirroring `AuthService.progressFor` on the backend exactly.
- **Start Here** (`src/pages/StartHere.tsx`) — the employee-facing
  guided flow: live progress, today/upcoming/overdue tasks,
  pre-checkpoint knowledge articles, entitlements, and private notes,
  all on one page.
- **HR Dashboard** (`src/pages/HrDashboard.tsx`) — all onboardings /
  what's-stuck views with department/status filters and pagination,
  plus "Add Joiner" (creates the user, then instantiates their
  onboarding — two backend calls, one HR action).
- **My Tasks** (`src/pages/TaskOwnerDashboard.tsx`) — a task_owner's
  claimed tasks, scoped server-side.
- **Community** (`src/pages/Community.tsx`) — posts, comments, voting,
  and (SuperAdmin/HR only) removal with a reason. Author identity is
  hidden server-side, not client-side — this UI just renders
  "Anonymous" whenever `author_id`/`author_name` come back null.

## Known gaps / deliberate scope boundaries

- **Templates, Entitlements admin, Documents, Activity Log** have no
  dedicated screens — Step 38's plan wording calls for "Start Here,
  three dashboards, community UI" specifically, not a full admin panel
  for every backend module.
- **Entitlement claim status** isn't indicated by the list endpoint
  (`GET /entitlements` doesn't say whether the caller already claimed
  each one) — `StartHere.tsx` works around this by treating a `409`
  claim response as "already claimed" rather than an error, tracked in
  local component state. A `claimed: boolean` field on that endpoint's
  response would be a cleaner fix if this becomes a recurring need.
- **Login identifier type** (temp vs. company email) is inferred
  client-side from the domain suffix, since the backend's login
  response doesn't say which kind of identifier was used — see the
  comment in `Login.tsx`.
- **Task claiming UI** doesn't exist yet — a task_owner currently has
  no screen to browse claimable tasks; only to see what they've already
  claimed. This would naturally live on a future "onboarding detail"
  view once one exists.
