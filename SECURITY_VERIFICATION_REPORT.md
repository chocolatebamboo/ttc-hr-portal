# TTC HR Portal — Security Verification Report

**Scope:** every table, view, storage bucket, database function, and API route used by the app.
**Target:** the live Supabase project (`chocolatebambooproductions@gmail.com's Project`, ref `boqzfvhfvgluzxmyomvf`, region `ca-central-1`, Postgres 17.6).
**Method:** live queries and live access tests against that real database via the Supabase MCP connection — not mocks, not assumptions. Every claim below was checked by running SQL as the actual Postgres role in question (`app_user`, `anon`, `authenticated`) and reading the actual result, not by reading policy text and reasoning about what it should do.
**Date:** 2026-08-29.

## Bottom line

No open critical or high-severity access-control findings. Three real defects were found and fixed during this audit (see below) — two would have been serious in production, one was introduced and caught within this same session. Everything in this report reflects the database's state *after* those fixes, re-verified live.

## Findings fixed during this audit

| # | Severity | What | Fix |
|---|----------|------|-----|
| 1 | **Critical** | `current_employee_id()` cast the session variable to `uuid`, but every id column Prisma generates is `text` (no `@db.Uuid` anywhere in the schema). Postgres has no `text = uuid` operator — every RLS policy using it would have thrown a hard error on every single request, against a real database. This had never been exercised against real Postgres before this session; every earlier verification used JS mocks that can't catch a database-level operator error. | Function now returns `text`, no cast. Verified live: 8/8 access-pattern checks pass. |
| 2 | **Critical** | `Department`, `Announcement`, and `AnnouncementAudience` had RLS disabled entirely. Supabase auto-exposes every public-schema table over its own REST API to the `anon`/`authenticated` roles regardless of whether the app uses that API — so anyone holding the public anon key could have read and written those tables directly, bypassing the app completely. Caught immediately by Supabase's own advisor the moment the schema was created live. | RLS enabled + forced, with the same admin-write/authenticated-read policy pattern used everywhere else in the file. |
| 3 | **Medium (self-inflicted, caught same session)** | While hardening the four RLS helper functions' `search_path` (a separate advisor WARN), setting it to `''` (empty) broke `is_admin()`, which calls `current_role_name()` unqualified — an empty search_path can't resolve that name, so every policy would have failed on every request. | Corrected to `search_path = 'public'`, which still satisfies the advisor and preserves the functions' ability to call each other. Caught by testing live immediately after applying the change, not by trusting the advisor's clean re-scan alone. |

Additionally hardened, not a defect but a real gap: **`anon` and `authenticated` held full SELECT/INSERT/UPDATE/DELETE grants on every HR table** (Supabase's default for new tables). RLS was already blocking them (verified), but this meant a single future RLS policy mistake — like #3 above — would have turned directly into a full data exposure through the public anon key rather than an app error. Revoked all grants from `anon`/`authenticated` on every public-schema table, including for tables created in the future. Zero functional impact: the app never authenticates as either role, only as `app_user`.

## Table-by-table: RLS and role access

All 13 application tables have RLS **enabled and forced**. "Roles" below is who can do what *in practice* — the Postgres grant plus the RLS policy together, which is what actually determines access, not either alone.

| Table | RLS | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|---|
| Employee | ✅ forced | self, own supervisor's reports, any active employee (directory), admin | admin only |
| TimeEntry | ✅ forced | self, own supervisor's reports, admin | self (own row only), own supervisor, admin |
| TimeEntryAuditEvent | ✅ forced | self's entries, own supervisor's reports' entries, admin | **insert-only, by anyone** — no update/delete policy exists for anyone, including admins (immutable audit trail) |
| PtoRequest | ✅ forced | self, own supervisor's reports, admin | self (own row only), own supervisor, admin |
| Document | ✅ forced | GLOBAL: all; DEPARTMENT/INDIVIDUAL: assigned only; CONFIDENTIAL_HR: admin only, no exceptions | admin only |
| DocumentAssignment | ✅ forced | self's assignments, own department's, admin | admin only |
| DocumentAcknowledgment | ✅ forced | self, admin | insert: self only; **no update/delete policy for anyone** |
| EmployeeOnboarding | ✅ forced | self, admin | admin only |
| OnboardingItem | ✅ forced | self's items, admin | update: self's items or admin; insert: admin only |
| AuditLog | ✅ forced | admin only | **insert-only, by anyone** — no update/delete policy exists for anyone, including admins (immutable) |
| Department | ✅ forced | any authenticated employee | admin only |
| Announcement | ✅ forced | any authenticated employee | admin only |
| AnnouncementAudience | ✅ forced | any authenticated employee | admin only |

"Any authenticated employee" means: the request went through `withRlsContext()` with a real, resolved `employeeId` — i.e. a genuine logged-in session — not merely holding an API key. An unauthenticated request (no session variables set) is denied by every single policy above; this is the fail-closed default and was verified directly (see below).

**`anon` / `authenticated` (Supabase's public/PostgREST roles):** zero grants on any of the 13 tables above, as of this audit. A request authenticated with nothing but the public anon key cannot read, insert, update, or delete a single row in any HR table — confirmed with a literal `permission denied` at the grant level, independent of RLS.

## Storage

- `documents` bucket: created, **private** (`public: false`).
- `storage.objects` / `storage.buckets`: RLS enabled by Supabase by default, and **zero policies are defined** for either. Postgres RLS default with no policy = deny for everyone who isn't the table owner or `BYPASSRLS` — verified live: `anon` sees 0 rows querying `storage.objects` directly.
- The app never lets a client reach storage directly. `/api/documents/[id]/download` resolves the document under the caller's own RLS identity first (`getDocumentForDownload`, via `withRlsContext`) and only mints a short-lived signed URL — using the service-role key — *after* that check passes. A document that RLS wouldn't let the caller read never reaches the storage layer at all.
- Net result: there is no direct public URL that reaches a stored file. The only path is through the app's own authorization check.

## `service_role` key exposure

- Referenced in exactly one file: `src/lib/supabase/admin.ts`. Not prefixed `NEXT_PUBLIC_`, not present in any `"use client"` file.
- Used only by `src/lib/storage.ts`, which is only imported by two server-side API routes (`documents/manage`, `documents/[id]/download`) — never by a client component.
- Confirmed the authorization check (`getDocumentForDownload`) always runs *before* the service-role client is ever constructed, both by reading the code and by the download route's own doc comment describing that ordering.

## Database functions — privilege-escalation review

All four RLS helper functions (`current_employee_id`, `current_role_name`, `is_admin`, `current_auth_user_id`) reviewed:

- **`SECURITY INVOKER`** (the default) — none are `SECURITY DEFINER`. They run with the calling role's own privileges, not elevated ones. No privilege-escalation surface.
- `search_path` explicitly set to `public` on all four (closes the advisor's WARN; verified this doesn't break their cross-calls — see Finding #3 above).
- No triggers exist anywhere in the `public` schema.
- These are the only four functions in `public` schema; there is nothing else to review.

## Live cross-employee access tests

Two rounds, run as the actual `app_user` Postgres role (via `SET ROLE`, since RLS applies to it regardless of session variables) against seeded throwaway test data, cleaned up after each round. Every result below is the literal row count Postgres returned, not a prediction.

| Test | Expected | Result |
|---|---|---|
| No session identity set (`app_user`, no session vars) — Employee | 0 (fail closed) | ✅ 0 |
| No session identity set — TimeEntry | 0 (fail closed) | ✅ 0 |
| No session identity set — Department | 0 (fail closed) | ✅ 0 |
| Employee sees own TimeEntry | 1 | ✅ 1 |
| Employee sees own PTO request | 1 | ✅ 1 |
| Employee sees own Document assignment | 1 | ✅ 1 |
| Employee sees own EmployeeOnboarding + item | 1 / 1 | ✅ 1 / 1 |
| Employee sees CONFIDENTIAL_HR document (non-admin) | 0 | ✅ 0 |
| Employee (non-admin) sees AuditLog | 0 | ✅ 0 |
| Directory: employee sees all active coworkers | 4 (all seeded) | ✅ 4 |
| Unrelated employee (not a peer/report) sees another's TimeEntry | 0 | ✅ 0 |
| Unrelated employee sees another's PTO / Document assignment / Onboarding / item | 0 (all four) | ✅ 0 / 0 / 0 / 0 |
| Unrelated employee sees a **deactivated** coworker in the directory | 0 | ✅ 0 |
| Supervisor sees direct report's TimeEntry | 1 | ✅ 1 |
| Supervisor sees direct report's PTO request | 1 | ✅ 1 |
| Supervisor sees their own **deactivated** direct report (records purposes) | 1 | ✅ 1 |
| Admin sees all seeded employees | 4 | ✅ 4 |
| Admin sees both Document visibility tiers (individual + confidential) | 2 | ✅ 2 |
| Admin sees AuditLog | 1 | ✅ 1 |
| Admin attempts to UPDATE an AuditLog row | 0 rows affected (no policy = deny, even for admin) | ✅ 0 |
| Admin attempts to DELETE an AuditLog row | 0 rows affected | ✅ 0 |
| Bootstrap identity (`current_auth_user_id` only, pre-login-resolution) finds exactly the caller's own row, nothing else | 1 self / 0 others | ✅ 1 / 0 |
| `anon` role queries Employee table directly | permission denied (no grant) | ✅ denied |
| `anon` role queries `storage.objects` | 0 (RLS, no policy) | ✅ 0 |

**On "changing an employee ID in the URL/request body":** every "unrelated employee" row above *is* that test — RLS evaluates against the caller's own session identity, never against what ID the request happens to ask for. A hypothetical app-layer bug that trusted a client-supplied `employeeId` would still be blocked at the database layer, because RLS doesn't know or care what the app intended to allow; it only knows who is actually asking. This is verified, not assumed.

## Schema / RLS / live database sync

- `prisma/schema.prisma` → the live schema was generated directly from it (this sandbox can't run `prisma migrate` itself — see README — so the DDL was hand-translated and applied via migration, then the live structure was read back and checked column-for-column against the schema file).
- `prisma/rls.sql` was updated to match every fix made live during this audit (the `text`-not-`uuid` fix, the `search_path` fix as **real executable statements** — it was previously only documented in a comment, which would not have survived a fresh deploy — and the new anon/authenticated revoke). The entire file was then re-run against the live database end-to-end and applied with **zero errors**, which is the actual proof it matches, not just an inspection.
- Net effect: a fresh deploy following the README today reproduces exactly what's live right now, including every fix from this audit.

## What this report does not cover

- The Next.js app has not been deployed anywhere yet — this audit is entirely at the database/infrastructure layer, which is what was asked for. Application-layer authorization (`src/lib/authorization.ts`, `requireEmployee()` on every route) was reviewed as part of an earlier pass this session and spot-checked again here, but a full re-audit of app-layer code was out of scope for this pass.
- Pilot accounts have not been created against this project yet (see `PILOT_TESTING.md` / `scripts/create-pilot-accounts.mjs`).
- `SUPABASE_SERVICE_ROLE_KEY` still needs to be copied from the Supabase dashboard (Project Settings → API → `service_role` secret) into `.env.local` — it's not retrievable through this audit's tooling by design, and shouldn't be.
