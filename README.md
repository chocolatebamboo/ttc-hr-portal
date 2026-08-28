# TTC HR Portal

Internal HR portal for Talented Teen Club — replaces BambooHR for HR administration while
TTC's payroll company keeps handling payroll itself. Built as a separate app from the public
`talentedteenclub.org` Wix site (see the *Implementation Assessment* artifact from project
kickoff for why), meant to live at `hr.talentedteenclub.org`.

**Status: early foundation, not launched.** This is not the full Phase 1 scope yet — see
"What's built so far" below for exactly what works today and "Roadmap" for what's next.
Nothing here fakes functionality that isn't real; unbuilt sections say so in the UI itself.

## What's built so far

- **Authentication** — Supabase Auth (managed password hashing, sessions, password reset).
  Sign in, forgot/reset password all work end-to-end.
- **Role-aware app shell** — four roles (Super Admin, HR Admin, Supervisor, Employee),
  desktop sidebar + mobile bottom nav, admin-only sections hidden from employees.
- **Time & Attendance** — the full clock-in → lunch → clock-out flow, a weekly timesheet
  view, and an audit trail that records every clock event. This is the one module built and
  intended to be *solid* before anything else — per the brief, it's what employees touch
  every day.
- **Data model** — the full schema for every Phase 1 module (`prisma/schema.prisma`), even
  though only Time & Attendance has UI/API built on top of it yet.
- **Two independent authorization layers** — every API route checks permissions in code
  (`src/lib/authorization.ts`), and Postgres Row-Level Security policies
  (`prisma/rls.sql`) enforce the same rules again at the database layer, so a bug in one
  doesn't expose data the other was supposed to catch.

## What's NOT built yet

PTO requests, the document center + acknowledgments, onboarding, the directory,
announcements, supervisor timesheet approval, the HR/admin dashboards, and the payroll hours
export. Every corresponding nav link in the app currently opens a page that plainly says
"Not built yet" rather than pretending. See **Roadmap** for the build order.

## Getting set up

### 1. Create the Supabase project

Create a project at supabase.com. You'll need three things from it: the project URL, the
anon public key, and the Postgres connection details (Project Settings → Database).

### 2. Create the restricted database role

Row-Level Security only protects anything if the app connects as a role that isn't a
superuser. In the Supabase SQL editor, run `prisma/rls.sql` — but first replace
`REPLACE_ME` with a real generated password, and note it for `DATABASE_URL` below.

You'll run this file again after your first `prisma migrate deploy` too (it's safe to
re-run — it uses `if not exists` / `create or replace` throughout).

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `DATABASE_URL` — connects as `app_user` (the restricted role from step 2), **not** the
  default `postgres` superuser Supabase gives you. This is what makes RLS real.
- `MIGRATE_DATABASE_URL` — the elevated `postgres` connection string, used only by
  `prisma migrate` locally/in CI, never by the deployed app.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase Project
  Settings → API.

### 4. Install, migrate, run

```bash
npm install          # also runs `prisma generate` via postinstall
npx prisma migrate dev --schema prisma/schema.prisma   # uses MIGRATE_DATABASE_URL
# then re-run prisma/rls.sql in the Supabase SQL editor (step 2) against the fresh tables
npm run dev
```

> A note on this repo's own build history: `prisma generate` and Google Fonts both fetch
> from hosts that were network-blocked in the sandboxed environment this was built in, so
> the Prisma client itself couldn't be generated or fully type-checked there. Everything
> else — the full Next.js build, ESLint, and all ~30 source files — was verified clean.
> Run `npm install && npm run build` in a normal environment (or CI) as the first real
> smoke test before trusting this further.

### 5. Brand tokens

`src/app/globals.css` has **placeholder** TTC blue/pink pulled from the club logo. Replace
`--ttc-blue`, `--ttc-pink`, etc. with the exact values from the Wix Editor's Design panel
(Site → Design → Colors/Fonts) or TTC's brand guidelines before this is user-facing.

### 6. The `hr.` subdomain

In Wix (Settings → Domains → your connected domain → DNS Records), add a CNAME record for
`hr` pointing at whatever your hosting provider (e.g. Vercel) gives you for a custom domain.
This doesn't touch anything else about the public site.

## Roadmap (Phase 1 build order)

Matches the order in the project brief — each step is built and tested before the next
starts:

1. ~~Infrastructure~~ ✅
2. ~~Data model + RLS~~ ✅
3. ~~Auth + role-aware shell~~ ✅
4. ~~Time & Attendance~~ ✅ (clock in/lunch/out, timesheet, audit trail)
5. Supervisor timesheet approval
6. PTO request + approval
7. Document center + acknowledgments
8. Onboarding checklist
9. Directory + announcements
10. Payroll hours export (CSV)
11. Security + mobile test pass — the "Employee A can't see Employee B" tests, for real,
    against every module
12. Pilot accounts (1 HR/Super Admin, 1 Supervisor, 2–3 Employees) running the complete
    workflows from the brief

Admin-facing documentation ("Administrator Instructions" in the brief) will be written once
there's real UI for HR to follow instructions against — writing it earlier would describe
screens that don't exist yet.

## Security notes for whoever reviews this before launch

- Every sensitive table has RLS enabled **and forced** (`prisma/rls.sql`) — table ownership
  doesn't bypass it.
- `withRlsContext()` (`src/lib/db.ts`) is how every authenticated query should run; it sets
  the session variables the RLS policies check. A route that imports the bare `prisma`
  export instead of using this helper is skipping the database-layer backstop — that's a
  reviewable red flag, not a style choice.
- Deactivation (`Employee.deactivatedAt`) is checked on every single request via
  `getCurrentEmployee()` — there is no session-caching of role/status that could let a
  deactivated employee keep working until their session naturally expires.
- No SSNs, banking details, or payroll credentials anywhere in the schema — intentional,
  per the brief's payroll-handoff boundary.
