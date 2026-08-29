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
- **Supervisor timesheet approval** — a supervisor's "My Team" page lists their direct
  reports (queried from the actual `supervisorId` relationship, not a client-supplied list)
  with an awaiting-approval count, drilling into a per-employee weekly timesheet with
  Approve / Return actions. Returning requires a comment, per the brief. The employee then
  sees exactly why on their own timesheet, and can edit and resubmit that one day — closing
  the loop the brief's "Employee correction requested" audit action implies but doesn't
  fully spell out.
- **PTO request + approval** — employees submit time-off requests (type, dates, hours,
  reason) from Time Off, see their own request history, and can cancel a still-Pending one.
  Supervisors decide (Approve / Deny, with an optional note on denial) from the same
  employee page as timesheet review — it's the same supervisor relationship, so it lives in
  the same place rather than a second parallel "team" screen. Denied requests show the
  reviewer's note to the employee. No payroll math is derived from PTO, per the brief.
- **Document Center + acknowledgments** — HR/Super Admin uploads a document (title, category,
  and who it's visible to: everyone, one department, one employee, or confidential
  HR/Admin-only) to private Supabase Storage; every employee sees only what RLS says they may
  see on their own Documents page, with a "View" link that opens a short-lived signed URL
  (never a public one) and an "Acknowledge" button for documents that require it. The Manage
  tab (admins only, same page) tracks acknowledgment progress per document and can archive
  one. The acknowledgment is explicitly labeled, in the UI itself, as a read-and-confirm
  record for HR — not a legal electronic signature, per the brief.
- **Onboarding checklists** — HR starts a new hire's checklist (seeded with five standard
  starter items) from the Manage tab on the same Onboarding page every employee sees; items
  check off the same way whether the employee does it themselves or HR does it on their
  behalf, because that's the same underlying action gated by the same RLS policy, not two
  separate code paths. HR can add custom items per employee. A checklist's completion date is
  set automatically the moment every item is checked, and cleared again if an item (including
  a newly added one) goes back to incomplete.
- **Directory** — every active employee, to every authenticated employee: name, title,
  department, role, work email, work phone — nothing more. This is the one place in the app
  where RLS's row-level grant is deliberately broader than what any single request needs; see
  "Security notes" below for why that's safe and where the real narrowing happens.
- **Announcements** — HR/Super Admin posts a company-wide, department, or individual
  announcement, with an optional expiration date. Employees see only what's currently published
  and targeted at them; the Manage tab shows every post (including future-dated "Scheduled" and
  past-expiration "Expired" ones) with who it targeted, and can delete one outright — unlike
  Documents, there's no archive/audit-trail concept for a post that was never a legal or HR
  record in the first place.
- **Payroll hours export** — HR/Super Admin picks a date range on the Reports page and gets a
  preview table, or downloads it straight as a CSV, of approved hours per employee: regular
  hours (from Time & Attendance) plus vacation/sick/personal/other-leave hours (from approved
  PTO requests), and a total. Genuinely just hours — no pay rate, overtime multiplier, or tax
  withholding anywhere in this feature, per the brief's payroll-handoff boundary. Only
  `APPROVED` time entries count; if anything in the chosen period is still awaiting review, the
  page says so before HR downloads a number that's quietly missing hours.
- **Data model** — the full schema for every Phase 1 module (`prisma/schema.prisma`), even
  though only Time & Attendance, PTO, Documents, Onboarding, Directory, Announcements, and the
  payroll hours export have UI/API built on top of it yet.
- **Two independent authorization layers** — every API route checks permissions in code
  (`src/lib/authorization.ts`), and Postgres Row-Level Security policies
  (`prisma/rls.sql`) enforce the same rules again at the database layer, so a bug in one
  doesn't expose data the other was supposed to catch.

## What's NOT built yet

The HR-wide Attendance and PTO Management dashboards, an Employees admin page, and system-level
Administration settings — all still stubs, see the "Not yet built, worth flagging now" note
below. Every corresponding nav link in the app currently opens a page that plainly says "Not
built yet" rather than pretending. See **Roadmap** for the build order.

Also worth flagging: Directory and Announcements have no "manage employees" overlap with the
still-unbuilt `/admin/employees` page — Directory is read-only for everyone (including HR), and
an announcement's audience picker reuses the same roster the Documents assignee picker uses
(`src/lib/roster.ts`), not a separate employee-management feature.

Within the Document Center itself, one thing is deliberately deferred: replacing a document
with a new file to trigger re-acknowledgment. The data model supports it (`Document.version`,
and `DocumentAcknowledgment` is keyed on `documentVersion` for exactly this reason), but there
is no "upload a new version" action in the UI yet — today, re-issuing a policy means
uploading it as a new document and archiving the old one.

## Getting set up

### 1. Create the Supabase project

Create a project at supabase.com. You'll need three things from it: the project URL, the
anon public key, and the Postgres connection details (Project Settings → Database).

### 2. Create the restricted database role

Row-Level Security only protects anything if the app connects as a role that isn't a
superuser. In the Supabase SQL editor, run `prisma/rls.sql` — but first replace
`REPLACE_ME` with a real generated password, and note it for `DATABASE_URL` below.

You'll run this file again after your first `prisma migrate deploy` too (it's safe to
re-run — every `create policy` is preceded by `drop policy if exists`, the role creation
uses `if not exists`, and the helper functions use `create or replace`).

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `DATABASE_URL` — connects as `app_user` (the restricted role from step 2), **not** the
  default `postgres` superuser Supabase gives you. This is what makes RLS real.
- `MIGRATE_DATABASE_URL` — the elevated `postgres` connection string, used only by
  `prisma migrate` locally/in CI, never by the deployed app.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase Project
  Settings → API.
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Project Settings → API → `service_role`
  secret. Server-only: never prefix it with `NEXT_PUBLIC_`, never send it to the browser.
  It's what lets the app upload documents and mint signed download URLs (see "Document
  storage bucket" below) — it bypasses Supabase's own access rules entirely, so the app's own
  authorization check in `src/lib/documents.ts` is the only thing standing between an
  employee and someone else's document.

### 3b. Document storage bucket

In the Supabase dashboard, go to Storage and create a new bucket named exactly `documents`.
**Leave "Public bucket" unchecked** — a public bucket would make every uploaded document
readable by anyone who guesses or intercepts a URL, bypassing every authorization check this
app makes. The app never talks to this bucket with a user's own session; it always goes
through the service-role key from a server route, after `src/lib/documents.ts` has already
confirmed (via Postgres RLS, under that specific employee's identity) that they're allowed to
see the document in question.

### 4. Install, migrate, run

```bash
npm install          # also runs `prisma generate` via postinstall
npx prisma migrate dev --schema prisma/schema.prisma   # uses MIGRATE_DATABASE_URL
# then re-run prisma/rls.sql in the Supabase SQL editor (step 2) against the fresh tables
npm run dev
```

> A note on this repo's own build history: `prisma generate` fetches from a host that was
> network-blocked in the sandboxed environment this was built in, so the Prisma client itself
> couldn't be generated or fully type-checked there. Everything else — the full Next.js
> build, ESLint, and all source files — was verified clean. Run `npm install && npm run build`
> in a normal environment (or CI) as the first real smoke test before trusting this further.

### 5. Brand tokens and design direction

`src/app/globals.css` uses TTC's **exact** brand colors — sampled directly from
`public/ttc-logo.png` (blue `#0169F0`, pink `#ED008C`), not placeholders. `--ttc-pink-ink`
and `--ttc-blue-ink` are darkened variants used anywhere brand color sits behind small text
(button labels, nav links), so contrast stays readable — the bright brand pink itself is
reserved for large/bold text, borders, and icon accents, matching how TTC's own branded
BambooHR instance uses it. The visual language (bold serif page titles, pill-shaped buttons,
pink active nav state, centered-icon empty states) was modeled on a screen recording of that
BambooHR instance the client provided, not copied wholesale — see `.page-title`, `.btn-primary`,
`.btn-outline`, and `.btn-neutral` in `globals.css` for the shared building blocks every page
should use rather than one-off button styling.

The two fonts (Fraunces for page titles/the logo wordmark, IBM Plex Sans for everything else)
are **self-hosted** via the `@fontsource` packages, imported in `src/app/layout.tsx` — not
`next/font/google`. That started as a fix for this same sandbox constraint (no network access
to fonts.googleapis.com meant every page title silently fell back to a generic system serif,
which is what first read as "inconsistent fonts"), but it's the right call regardless: no
external request at page-load time, so the app never depends on Google's fonts CDN being
reachable or unblocked by whatever network a school or nonprofit's office happens to be on.

### 6. The `hr.` subdomain

In Wix (Settings → Domains → your connected domain → DNS Records), add a CNAME record for
`hr` pointing at whatever your hosting provider (e.g. Vercel) gives you for a custom domain.
This doesn't touch anything else about the public site.

### 7. Pilot accounts

Once the app is actually deployed and reachable at a real URL (not just `localhost`), edit
`scripts/create-pilot-accounts.mjs` with the real names/emails of the pilot cohort (one
HR/Super Admin, one Supervisor, two or three Employees reporting to that Supervisor) and run
`npm run pilot:create-accounts`. It creates real Supabase Auth accounts (each person gets an
email invite to set their own password — the script never sees or sets a real password for
anyone) and the matching `Employee` rows, wired with the org relationships the pilot workflows
need. It's idempotent — safe to re-run if you add someone or fix a typo.

See **`PILOT_TESTING.md`** for the actual per-role workflow checklist to run the pilot
against — this is the step that's meant to catch what a solo mock-and-screenshot cycle can't:
real email deliverability, real phones and browsers, and people who don't already know where
every button is.

## Roadmap (Phase 1 build order)

Matches the order in the project brief — each step is built and tested before the next
starts:

1. ~~Infrastructure~~ ✅
2. ~~Data model + RLS~~ ✅
3. ~~Auth + role-aware shell~~ ✅
4. ~~Time & Attendance~~ ✅ (clock in/lunch/out, timesheet, audit trail)
5. ~~Supervisor timesheet approval~~ ✅ (My Team, review + approve/return, employee correction + resubmit)
6. ~~PTO request + approval~~ ✅ (submit, cancel, supervisor approve/deny with a note)
7. ~~Document center + acknowledgments~~ ✅ (upload, per-role visibility via RLS, view via
   signed URL, acknowledge, archive, admin progress tracking — "upload a new version" not yet
   built, see "What's NOT built yet")
8. ~~Onboarding checklist~~ ✅ (HR starts + seeds a checklist, custom items, self- or
   admin-completion, auto-tracked completion date)
9. ~~Directory + announcements~~ ✅ (searchable company directory; HR posts company-wide,
   department, or individual announcements with an optional expiration date)
10. ~~Payroll hours export (CSV)~~ ✅ (approved regular + PTO hours per employee for a chosen
    date range, previewed on the Reports page and downloadable as CSV; warns if anything in the
    period is still awaiting approval)
11. ~~Security + mobile test pass~~ ✅ (found and fixed a real pre-existing RLS bug — see
    "Security notes" below — then ran ~20 cross-employee authorization tests against every
    module plus a mobile-viewport pass on every page; nothing else found)
12. Pilot accounts (1 HR/Super Admin, 1 Supervisor, 2–3 Employees) running the complete
    workflows from the brief — **tooling ready, not yet run**: no Supabase project exists yet
    for this app (see "Getting set up" §7 / `scripts/create-pilot-accounts.mjs` and
    `PILOT_TESTING.md`). This is the one roadmap step that genuinely needs real infrastructure
    and real people, not something buildable further in isolation.

**Not yet built, worth flagging now:** an HR-wide attendance view and an HR-wide "upcoming
PTO across everyone" view (both `/admin/attendance` and `/admin/pto`, still stubs — HR
today can only see one supervisor's team at a time, same as a supervisor can), and bulk
"approve the whole week in one click" — right now each day/request is decided individually,
which is correct but a little slow for a supervisor with a big team.

Admin-facing documentation ("Administrator Instructions" in the brief) will be written once
there's real UI for HR to follow instructions against — writing it earlier would describe
screens that don't exist yet.

## Security notes for whoever reviews this before launch

- **A real bug was found and fixed during the step 11 security pass, and it would have broken
  login for everyone against a real database.** `getCurrentEmployee()` (`src/lib/auth.ts`) —
  the function every single request uses to figure out who's asking — used to run its Employee
  lookup through the bare `prisma` export instead of `withRlsContext()`. That's exactly the
  "reviewable red flag" the bullet below warns about, and it's a chicken-and-egg case: at the
  moment this function runs, the app doesn't know the caller's `employeeId` yet — resolving it
  is the whole point of the query — so there was nothing to pass `withRlsContext()`. Postgres
  RLS is forced on `Employee` regardless of whether session variables are set, and the old
  `employee_select` policy's clauses (`is_admin()`, `id = current_employee_id()`,
  `supervisorId = current_employee_id()`) all evaluate to `NULL`/false with no session variable
  set — so this lookup would have silently returned zero rows for every user, every time,
  against a real Postgres connection. It "worked" all session because every preview mock up to
  this point replaced `getCurrentEmployee()` entirely rather than exercising its real body, so
  nothing had exercised this path against real RLS semantics before now. The same bare-`prisma`
  pattern was also present in `canAccessEmployeeRecords()`'s supervisor check
  (`src/lib/authorization.ts`), which would have permanently blocked every supervisor from
  their own reports' timesheets and PTO for the same reason.

  Fixed two ways: (1) a new `current_auth_user_id()` SQL function plus a `userId` clause on
  `employee_select` (`prisma/rls.sql`), and a new `withUserIdContext()` helper (`src/lib/db.ts`)
  that sets `app.current_user_id` instead of `app.current_employee_id` — this is the one lookup
  in the app that legitimately can't know its own identity in advance, so it gets its own
  narrower bootstrap path scoped to exactly the caller's own row; (2) `canAccessEmployeeRecords()`
  now uses `withRlsContext()` with the actor's already-known identity, like everywhere else.
  Verified against both a standalone script modeling the exact Postgres session-variable/NULL
  semantics and a live functional pass hitting the real route handlers.

  While in there, also hardened a second, related weakness: the Directory's
  `or "deactivatedAt" is null` clause (see the next bullet) had no identity dependency at all,
  so it would have let *any* unscoped query — including a hypothetical future bug that skipped
  authentication entirely — read every active employee's row. It's now
  `or (current_employee_id() is not null and "deactivatedAt" is null)`, so the RLS layer stays a
  real backstop rather than a no-op even for queries that were never supposed to run unscoped.

- **The mobile pass (also step 11) found nothing else.** Every page was checked at a 390×844
  viewport as each of four test identities (HR Admin, a supervisor, and two employees who are
  not each other's reports). The one thing that looks like a bug at first glance — timesheet
  tables getting visually cut off on narrow screens (My Time, and the supervisor's per-employee
  review page) — is the same intentional `overflow-x-auto` horizontal-scroll pattern already
  used elsewhere in the app (Reports, etc.), confirmed by checking `scrollWidth` vs.
  `clientWidth` and scrolling the table rather than trusting a single screenshot.

- **The authorization test matrix.** With the fix above in place, ran targeted cross-employee
  tests against every module — Time & Attendance approval, PTO decisions, Document
  confidentiality, Onboarding item toggling, Directory, Announcements, and every admin-only
  route (Documents/Onboarding/Announcements "manage", Payroll Reports, roster/assignable
  endpoints) — confirming the right 401/403/404/200 in each case. Notably: an employee can
  still *read* their own submitted timesheet entry or PTO request (that's `employee_select`'s
  self clause), but is correctly blocked from *approving* it — that's an app-layer role check
  (`assertCanReviewTimesheet`), not RLS, and the test matrix exercises both layers rather than
  assuming either one alone is sufficient.

- **The Directory's RLS grant is intentionally broad, and that's a documented trade-off, not an
  oversight.** Every other table's `_select` policy in `prisma/rls.sql` restricts both which
  rows AND (implicitly, since nothing broader is ever queried) which use cases can see them. The
  `Employee` table can't work that way once a directory exists — "see your coworker's name and
  title" and "see your coworker's personal cell number and emergency contact" are different
  employees calling the same table, and RLS only sees rows, not why the app is asking. So
  `employee_select` grants row visibility to any active employee for any authenticated
  employee, and the actual restriction — never returning personalPhone, personalEmail,
  emergencyContact*, employeeCode, hireDate, or deactivatedAt to a directory request — is
  enforced by `src/lib/directory.ts`'s own six-field Prisma `select`, which simply never asks
  the database for anything else. This is the same pattern Documents and Onboarding already use
  for admin-vs-employee DTOs (RLS says which rows, the query says which columns); Directory is
  just the first place a single table needs both a wide row grant and a narrow column grant at
  once. If you're adding a new query against `Employee`, this is the one table on which "I used
  `withRlsContext`" is not sufficient by itself — check what you're selecting.
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
