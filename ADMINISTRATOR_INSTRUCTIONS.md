# Administrator Instructions

A walkthrough of everything an HR Admin or Super Admin can do in the TTC HR Portal, written
against the app as it exists today. This is the "Administrator Instructions" the original
project brief called for — it was deliberately written last, once there was real UI to
describe, rather than earlier against screens that didn't exist yet. See README.md's "What's
NOT built yet" for the two admin areas (an Employees page, and system-level Administration
settings) this document can't cover because they aren't built.

Two roles can do everything in this document: **HR Admin** and **Super Admin**. The app
doesn't currently distinguish between them anywhere in the UI or in `src/lib/authorization.ts`
— both pass every `isAdmin()` check identically. A **Supervisor** can do a subset of this
(reviewing and deciding for their own direct reports only); an **Employee** can do none of it.
Every action described below is enforced twice — once in the application code
(`src/lib/authorization.ts`) and independently again by the database itself (Postgres
Row-Level Security, `prisma/rls.sql`) — so there's no admin action here that depends on the UI
alone to keep a non-admin out.

## Signing in

Admin accounts sign in the same way as everyone else, at the deployed URL's `/login` page,
with the email and password Supabase Auth has on file. There's no separate admin login. Once
signed in, the left sidebar (or the bottom nav on a phone) shows an extra section below the
regular employee links — Attendance, PTO Management, Documents' Manage tab, Onboarding's Manage
tab, Announcements' Manage tab, Reports, and Administration — that a non-admin never sees at
all, not even as a disabled/greyed-out link.

If you need to set someone's password directly instead of relying on the invite-email flow
(useful when a link has expired, or email delivery is unreliable), see
`scripts/set-password.mjs` — a one-off script that uses the same admin Supabase credentials as
the pilot account script and never routes the password through this app itself.

## Attendance (`/admin/attendance`)

The one place to see every active employee's timesheet status for a given week at once,
instead of opening each supervisor's team one at a time. Use the ← / → controls to move
between weeks, and the department dropdown to narrow the list to one department.

Each row shows a name, job title, department, an **Awaiting Approval** count (days that
employee has submitted but nobody has approved or returned yet), and a **Missing Clock-Outs**
count (a past day where the employee clocked in but the day was never closed out — today's
still-open entry is deliberately not counted here, since it may still be in progress).
Clicking a row opens that employee's own review page — the same page a supervisor uses for
their reports — where you can approve or return individual days, or use **Approve all
awaiting** to clear every day still awaiting approval in the visible week in one click. Bulk
approval only touches days actually still in the Awaiting Approval state, so it's safe to click
even if someone else approved or returned a day moments earlier.

This page doesn't replace a supervisor's own "My Team" review — it's the org-wide view HR
needs on top of it, drawing from the same underlying data and the same approve/return actions.

## PTO Management (`/admin/pto`)

The org-wide equivalent of a supervisor's PTO review, in two sections:

- **Pending** — every employee's still-undecided time-off request, oldest first, with
  Approve / Deny buttons right on the page. Deny accepts an optional note that the employee
  will see explaining why. This uses the exact same decision endpoint a supervisor uses, so
  approving or denying here shows up for the employee identically either way.
- **Upcoming approved leave** — every already-approved request whose leave hasn't fully ended
  yet (in progress or starting later), soonest first, so you can see who's already scheduled to
  be out before it becomes a same-day surprise. Nothing here is actionable — it's already
  decided; it's a lookahead, not a queue.

Clicking an employee's name from either section opens their own review page, same as
Attendance.

## Documents (`/documents`, Manage tab)

Admins see an extra **Manage** tab on the Documents page (alongside the same "My Documents"
tab every employee has, since admins have their own documents to read too). From Manage:

- **Upload Document** — pick a title, category, who it's visible to (everyone, one
  department, one specific employee, or Confidential — HR/Admin only), optionally require
  acknowledgment, and attach the file. A Confidential document can never require
  acknowledgment, since the employee it's about is never shown it in the first place — the
  checkbox is disabled and explained when that visibility is selected.
- **New version** — on any active (non-archived) document, upload a replacement file without
  losing the document's history. This bumps the version number shown next to the title and
  swaps in the new file; the previous file is kept in storage, not deleted. Because every
  employee's acknowledgment is recorded against a specific version, uploading a new version
  automatically means everyone who'd already acknowledged the old one needs to acknowledge
  again — there's no separate step to reset that, it's just a consequence of the version
  number changing. Use this for things like an annually-updated handbook, rather than
  archiving the old one and uploading a brand new document (which would lose the acknowledgment
  history and any progress tracking tied to it).
- **Archive** — removes a document from every employee's visible list without deleting the
  underlying record or file, for anything that's been fully superseded and shouldn't linger
  (e.g., a document you'd otherwise have replaced with a new version, but want to retire
  outright instead). Archiving is one-way in the current UI — there's no "unarchive" button, and
  an archived document can no longer be given a new version — so use New version instead of
  Archive-then-reupload if the document is still meant to be active.
- Below the upload form, every document (active, then archived) shows who it's assigned to and,
  for anything requiring acknowledgment, a live "X / Y acknowledged" count against the
  *current* version only — a stale acknowledgment of a superseded version never counts toward
  it.

## Onboarding (`/onboarding`, Manage tab)

From the Manage tab, start a new hire's checklist — it's seeded with five standard starter
items automatically, and you can add custom items beyond those (useful for a role-specific
requirement a standard checklist wouldn't cover). Items can be checked off either by the
employee themselves or by an admin on their behalf — both go through the same action, so there
isn't a separate "admin override" concept to think about. A checklist's completion date is set
the moment every item is checked, and clears again automatically if any item — including one
added after the fact — goes back to incomplete.

## Directory (`/directory`)

Read-only for everyone, admins included: name, title, department, role, work email, and work
phone for every active employee. Personal phone, personal email, and emergency contact
information are deliberately never shown here, even to an admin — those fields exist on the
employee's own record but the Directory's query never selects them, so there's nothing to
accidentally widen later. This is the one screen in the app where "everyone can see this row"
is intentional; what's restricted is which *columns* come back, not which rows.

## Announcements (`/announcements`, Manage tab)

Post a company-wide, single-department, or single-employee announcement, with an optional
expiration date. The Manage tab lists every post regardless of whether it's currently live —
including ones scheduled for the future and ones already expired — along with who it targeted,
and can delete a post outright. Unlike Documents, there's no archive concept here; a deleted
announcement is just gone, since a post was never meant to be a retained HR record the way a
document or a timesheet is.

## Reports (`/admin/reports`)

The one report this app produces: approved hours for a chosen date range, ready to hand to
TTC's external payroll company. Pick a start and end date, generate a preview on the page, and
download it as a CSV if it looks right. Columns are regular hours (from approved Time &
Attendance entries) plus vacation / sick / personal / other-leave hours (from approved PTO
requests) and a total — deliberately hours only, with no pay rate, overtime multiplier, or tax
withholding calculated anywhere, since that math belongs to the payroll company, not this app.
If anything in the chosen period is still awaiting approval, the page says so before you
download a number that would otherwise be quietly missing hours — go clear those from
Attendance first (or accept the gap knowingly) before running payroll off an export with that
warning showing.

## Deactivating an employee

There's no dedicated Employees admin page yet (see README's "What's NOT built yet"), so
deactivating someone today means setting `Employee.deactivatedAt` directly in the database —
ask whoever manages the Supabase project to do this, or run the update via Supabase's SQL
editor. The effect is immediate and total: `getCurrentEmployee()` checks `deactivatedAt` on
*every* request, not just at sign-in, so a deactivated employee is blocked on their very next
action rather than staying logged in until a session naturally expires. There is no
session-level caching of this status anywhere that would let a deactivated account keep
working past that point.

## What HR/Super Admin still can't do from the UI

An Employees admin page — adding a new employee (today that only happens as a side effect of
running `scripts/create-pilot-accounts.mjs`, or by hand against the database), editing an
existing one's title/department/supervisor, or reactivating a deactivated one — doesn't exist
yet, and neither does the system-level Administration page (`/admin/administration`, currently
a plain "Not built yet" stub). Both nav links are visible to admins today so their eventual
location in the app is obvious, but they don't pretend to work — see README.md's Roadmap for
where these sit in the build order.
