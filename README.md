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
- **Role-aware app shell** — four roles (Super Admin, HR Admin, Supervisor, Team Member),
  desktop sidebar + mobile bottom nav, admin-only sections hidden from team members.
- **Time & Attendance** — clock in and out any number of times a day (no lunch step — a break
  is just an ordinary clock-out/clock-in, same as any other gap in the day), a month-calendar
  "My Time" view (click a day to see every session logged, correct a returned one, or request
  that day off), and an audit trail that records every clock event. A day's status only moves
  to Awaiting Approval once the current session is closed — clocking back in later the same day
  (even on an already-Approved day) reopens it as In Progress until it's closed again, so a
  supervisor is never asked to approve hours that are still being added to. This is the one
  module built and intended to be *solid* before anything else — per the brief, it's what
  team members touch every day.
- **Supervisor timesheet approval** — a supervisor's "My Team" page lists their direct
  reports (queried from the actual `supervisorId` relationship, not a client-supplied list)
  with an awaiting-approval count, drilling into a per-team-member weekly timesheet with
  Approve / Return actions. Returning requires a comment, per the brief. The team member then
  sees exactly why on their own timesheet (as a red dot on that day in the My Time calendar),
  and can edit and resubmit that one day — closing the loop the brief's "Employee correction
  requested" audit action implies but doesn't fully spell out.
- **PTO request + approval** — folded into the My Time page rather than a separate Time Off
  page, so team members have one place for their calendar and their time-off requests. The
  calendar itself is a single continuously-scrolling list of months, modeled on the Airbnb
  host calendar CB referenced — it opens on the current month and scrolling down lazily loads
  and appends earlier months one at a time (there's nothing to click through), the same
  direction "My Time" already limited navigation to (past months, not future ones). The
  calendar column is also full-width next to the day panel rather than a fixed-width card with
  empty page beside it, so it uses the space the page actually has instead of leaving a wide
  gutter of white space. The primary way to request time off is straight from the calendar:
  click a day with nothing logged yet (today or any day after), or click-then-click a second
  one to select a whole run of empty days at once, and the panel offers the same form for
  however many days are selected. That panel is a non-blocking side panel — no backdrop, so
  the calendar underneath stays visible and clickable and clicking a different day just changes
  the selection instead of closing anything. On sm+ screens it's pinned in place (sticky) next
  to the calendar as the month list scrolls underneath it; on a phone it's a small floating
  card (not an edge-to-edge sheet) capped at half the screen height and floating clear of the
  bottom tab bar, so there's always calendar visible and scrollable around it. Any day already
  covered by a request (Pending, Approved, or Denied) shows that on the calendar instead of an
  hours readout. A "Request for another date" form below the calendar covers anything the
  calendar can't — a past date, or a date many months out —
  writing the exact same PtoRequest row as the calendar's own form, so the request list, its
  cancel action, and supervisor approval all just work regardless of which entry point created
  the request. Supervisors decide (Approve / Deny, with an optional note on denial) from the
  same team member page as timesheet review — it's the same supervisor relationship, so it lives
  in the same place rather than a second parallel "team" screen. Denied requests show the
  reviewer's note to the team member. No payroll math is derived from PTO, per the brief.
- **Availability** (`/availability`) — a team member taps specific dates on a My Time-style
  calendar, sets a start/end time for each, and submits them together as one record for a
  supervisor or HR/Super Admin to approve (CB, Sept 2026: "so that we don't have to manually
  keep on asking them what's their availability... the members just let us know when they're
  available, and then we will approve it so that we have a record on our side"). Not a
  standing weekly template — every submission is its own row (`AvailabilitySubmission`), so
  the full history of what was offered and decided stays on record rather than one row getting
  overwritten each time. A supervisor or HR/Super Admin decides from the same per-team-member
  page PTO/timesheet review already lives on (`TeamAvailabilitySection`), or org-wide from
  Administration's Availability page. Purely informational for now: nothing enforces it
  against anything, since there's no shift-scheduling feature yet to enforce it against.
- **Document Center + acknowledgments** — HR/Super Admin uploads a document (title, category,
  and who it's visible to: everyone, one department, one team member, or confidential
  HR/Admin-only) to private Supabase Storage; every team member sees only what RLS says they may
  see on their own Documents page, with a "View" link that opens a short-lived signed URL
  (never a public one) and an "Acknowledge" button for documents that require it. The Manage
  tab (admins only, same page) tracks acknowledgment progress per document and can archive
  one. The acknowledgment is explicitly labeled, in the UI itself, as a read-and-confirm
  record for HR — not a legal electronic signature, per the brief.
- **Guided onboarding** — a step-by-step flow, not a flat checklist: a team member sees exactly
  one step as "what you need to do right now," everything after it stays locked until that
  step is truly done (computed live from item order, never a stored flag that could drift), and
  everything before it is a completed trail. Steps are typed — Task (a plain checkbox, no
  approval), Document (acknowledges a real linked Document, reusing that module's own
  acknowledgment tracking rather than a second honor-system copy), Training, and Meeting.
  Document/Training/Meeting all route through an AWAITING_APPROVAL state that HR or the
  team member's own supervisor must Approve (unlocks the next step) or Return (with a required
  reason, sending it back to the team member to redo). HR starts a new hire's checklist — either
  the standard five-task starter, or a named, reusable Template ("Camp Counselor," etc.) built
  from HR's own Manage Templates screen — and adds typed steps beyond those from the Manage
  tab; supervisors get the same Manage tab scoped to their own direct reports. Applying a
  template just copies its steps into that one checklist at that moment (each step's own due
  date is the checklist's start date plus that step's configured offset); editing or deleting
  the template afterward never touches a checklist already started from it. A checklist's
  completion date is set automatically the moment every step is COMPLETED, and cleared again
  if any step (including a newly added one) isn't. Whether a team member has an actionable or
  returned step, or an admin/supervisor has anything awaiting their approval, is surfaced
  in-app only (no email) as a small dot on the Onboarding nav link and an entry in the
  Dashboard's "Needs your attention" list — recomputed live on every page load, never a stored
  notification to mark read. The admin/supervisor roster also shows one glance-able status pill
  per team member — Action Needed, Upcoming, Waiting on Team Member, Not Started, or Completed — so
  reviewing who needs what never requires opening every row. Starting a checklist also seeds two
  admin/supervisor-only panels, both explicitly invisible to the team member: an **Internal
  Readiness** checklist (background check, TTC email/Drive access, equipment, workspace, site
  tour, welcome meeting, external payroll setup — real Day-1 human tasks the app only tracks,
  never automates) and three fixed **30/60/90-Day Checkpoints** (due date, freeform notes,
  optional training-milestone/development-goal fields, a follow-up flag) — deliberately not a
  performance-management system, just a lightweight, un-gated follow-up record.
- **Certification** — a fifth step type, Certification, seeds TTC's real New Hire Excellence
  Certification Test (26 questions mirroring the source document one-for-one) in place of a
  single click: the team member answers every question and submits once. Multiple-choice,
  fill-in-the-blank, and select-all questions score instantly against an answer key; open-ended
  and scenario questions (and any question whose key HR hasn't configured yet — a fill-in or
  list question with no accepted answers is a deliberate "not configured" state, not a gap)
  route to HR or the team member's supervisor for manual grading, with CB's own rubric shown
  alongside each one. The step stays in Awaiting Approval until every manual question is graded
  and the combined score is checked against the 85% passing threshold from the source test —
  Approve is refused (with a plain-language reason) until grading is complete and the attempt
  actually passed; a failed attempt gets Returned like any other step, and resubmitting starts a
  fresh, separately-tracked attempt rather than overwriting the old one. Only the answer key
  itself (correct options, accepted text variants, the manual-review rubric) is admin-editable,
  from the same Manage tab's "Manage Certification Test" screen — question wording, order, and
  points mirror the real document and aren't meant to be rewritten in-app.
- **Directory** — every active team member, to every authenticated team member: name, title,
  department, role, work email, work phone — nothing more. This is the one place in the app
  where RLS's row-level grant is deliberately broader than what any single request needs; see
  "Security notes" below for why that's safe and where the real narrowing happens.
- **My Profile** — `/profile`, every team member's self-service view of their own record: photo,
  name/title/department/role/hire date read-only (HR-only changes, via the Team Members admin
  page), and an editable contact card (preferred name, work/personal phone, personal email,
  emergency contact). Enforced at two independent layers, same split as the rest of this app —
  the API only ever builds an update from that exact field list, and `prisma/rls.sql`'s
  `employee_self_update` policy plus its `enforce_employee_self_update()` trigger reject a
  non-admin write at the DATABASE level if it touches anything else (role, department, hire
  date, etc.), so an app-layer bug couldn't turn this into "edit anything about yourself" even
  by accident.
- **Announcements** — HR/Super Admin posts a company-wide, department, or individual
  announcement, with an optional expiration date. Team Members see only what's currently published
  and targeted at them; the Manage tab shows every post (including future-dated "Scheduled" and
  past-expiration "Expired" ones) with who it targeted, and can delete one outright — unlike
  Documents, there's no archive/audit-trail concept for a post that was never a legal or HR
  record in the first place.
- **Administration (department management)** — `/admin/administration` (HR/Super Admin only)
  manages `Department` rows directly: add one ahead of assigning anyone to it, rename one (every
  team member/document/announcement already pointing at it just sees the new name, since nothing
  about `departmentId` changes), or delete one — refused, with a clear explanation rather than a
  raw database error, while any team member, document, or announcement still references it. This is
  the one system-level setting the app actually needed a dedicated UI for; see "What's NOT built
  yet" below for what's deliberately not here.
- **Team Members admin page** — `/admin/employees` (HR/Super Admin only) lists every team member,
  active and deactivated, with full HR record fields Directory deliberately never shows
  (personal phone/email, emergency contact). Adding a new team member sends them a real Supabase
  invite email — the same `inviteUserByEmail` flow `scripts/create-pilot-accounts.mjs` uses,
  now built into the app itself — and creates their Department (by name, upserted) and
  Employee row. Editing covers everything except login email (would also require updating the
  linked Supabase Auth account, out of scope for now) and active/deactivated state, which is
  its own dedicated Deactivate/Reactivate action so it can't be fat-fingered inside a big edit
  form; self-deactivation is blocked outright. Granting or changing anyone's role to/from Super
  Admin is restricted to an actor who is already a Super Admin — an HR Admin can still edit
  every other field on a Super Admin's record, just not that one.
- **Google sign-in** — an optional second way in alongside email/password on `/login`, invite-
  gated exactly the same way: it's a faster door into an *already-invited* account, not a new
  one. Relies on Supabase Auth's own automatic identity linking by verified email, so no extra
  app-side "pending approval" state is needed — see README "Getting set up" §9 for the one-time
  Google Cloud Console + Supabase dashboard configuration this needs (not something the app can
  turn on by itself).
- **"View as" role preview** — Super Admin only, from the Team Members page: temporarily see the
  app exactly as one specific real team member would (their nav, their dashboard, their data),
  without creating a throwaway account or changing anyone's real session. Strictly read-only —
  `src/proxy.ts` refuses every non-GET/HEAD `/api/*` request while a preview is active (except
  exiting it), so nothing can be submitted, approved, or graded under a previewed identity. A
  persistent banner names who's being previewed and exits back to your own account from any
  page. See `src/lib/preview.ts` for the full design.
- **HR-wide Attendance dashboard** — `/admin/attendance` (HR/Super Admin only) lists every
  active team member for a selected week, not just one supervisor's team, with an
  awaiting-approval count and a missing-clock-out count per person and an optional department
  filter. No new RLS policy was needed for this — `is_admin()` already grants the
  `time_entry_select` policy full org-wide read access (`prisma/rls.sql`), so the query in
  `src/lib/attendance-admin.ts` simply doesn't filter by `employeeId` when the caller is an
  admin. Clicking a row opens the same per-team-member review page a supervisor uses.
- **HR-wide PTO dashboard** — `/admin/pto` (HR/Super Admin only) shows every team member's
  still-Pending requests as an actionable queue (Approve/Deny right there, same
  `/api/pto/requests/[id]/decide` endpoint a supervisor uses — an admin identity already
  passes `assertCanReviewTimesheet`'s admin bypass for any team member) plus every already-Approved
  request starting today or later, so HR can see upcoming coverage gaps before they happen.
- **Bulk timesheet approval** — the per-team-member review page (`/team/[employeeId]`, used by
  both supervisors and HR/Super Admin) now has an "Approve all awaiting" button that approves
  every day in the visible week still Awaiting Approval in one request
  (`POST /api/time/entries/bulk-approve` → `bulkApproveTimeEntries` in
  `src/lib/time-actions.ts`). It re-checks authorization and each entry's own status
  server-side rather than trusting the client's list, and silently skips (rather than failing
  the whole batch over) any entry someone else already decided in the meantime.
- **Document versioning** — HR/Super Admin can upload a replacement file for an existing
  document ("New version" on the Manage tab) without re-creating it: the file goes through the
  same private-storage upload as a new document, then `Document.version` increments and
  `storageKey` swaps to the new file. The old file is left in storage, not deleted. Because
  every acknowledgment is already keyed to `(document, employee, version)`
  (`DocumentAcknowledgment`'s unique constraint), bumping the version is by itself what makes
  every team member's prior acknowledgment stale again — no separate "clear acknowledgments" step
  exists or is needed.
- **Payroll hours export** — HR/Super Admin picks a date range on the Reports page (or clicks
  "This week" / "This month" for the current calendar period in one click) and gets a preview
  table, or downloads it straight as a CSV, of approved hours per team member: regular hours (from
  Time & Attendance) plus vacation/sick/personal/other-leave hours (from approved PTO requests),
  and a total. Genuinely just hours — no pay rate, overtime multiplier, or tax withholding
  anywhere in this feature, per the brief's payroll-handoff boundary. Only `APPROVED` time
  entries count; if anything in the chosen period is still awaiting review, the page says so
  before HR downloads a number that's quietly missing hours. A Team Member picker on the same page
  narrows the preview/CSV to one person (sourced from the same active-team-member list the
  Documents/Announcements assignee pickers use) or leaves it on "All team members" for the full
  company view — either way the CSV filename and download stay in sync with the current pick.
- **Clock-out reminders** — since there's no fixed schedule (everyone just clocks in/out
  whenever), a forgotten clock-out otherwise sits silently open until someone notices. Once a
  session's been open 3+ hours, the team member gets both an in-app banner on the Home page's time
  clock card (`src/components/TimeClockCard.tsx`, re-checks every minute so it appears on its
  own without a page reload) and an email (`src/lib/clockout-reminders.ts`, sent via Resend —
  see `.env.example`'s "Clock-out reminder emails" section for the setup that needs). It's a
  one-time nudge per open session, not a repeating one. The email side runs from
  `POST /api/cron/clockout-reminders`, hit on a schedule (every 15 minutes) rather than by any
  user-facing flow — protected by a shared `CRON_SECRET` instead of a signed-in session, since
  the caller has no team member identity of its own.
- **Auto clock-out** — a session left open past this reminder is still just a reminder, not a
  fix: CB, Sept 2026, after forgetting to clock out overnight, "it went over twelve hours, and
  then it documented it to be twelve hours. I don't necessarily want that because that's not
  necessarily true." Once a session's been open 4 hours, `src/lib/auto-clockout.ts` force-closes
  it — but at exactly the 4-hour mark, not whenever the job happens to run, so a session never
  gets credited with more elapsed time than the cap. The day it belongs to is put back into
  Awaiting Approval (the same status any ordinary clock-out produces) so a supervisor sees it in
  their normal review queue, and the audit trail records it as a distinct `AUTO_CLOCK_OUT` event
  (no team member or reviewer attached — it's the system closing the gap) so it's visibly
  different from a time entry the team member actually submitted themselves. Runs from
  `POST /api/cron/auto-clockout`, same `CRON_SECRET`-protected shape and same schedule as the
  two reminder endpoints above.
- **Notification preferences** — My Profile > Notifications (CB, Oct 2026: "I kind of want a
  notifications tab... they could toggle on which notifications that they could have... by
  default... email sent to them... whichever number attached to their profile or email"). Five
  self-service toggles (`Employee.notifyClockInEmail/notifyClockOutEmail/
  notifyAnnouncementEmail/notifyMessageEmail/notifyAvailabilityCutoffEmail`, all default on)
  covering clock-in reminders, clock-out reminders, announcements, messages, and the
  availability-cutoff reminder below — each routes to the employee's own existing `ttcEmail`,
  never a separate contact field. Phase A (email only, confirmed via
  `AskUserQuestion`: "Email now, text later") — the Text-message option shown on that tab stays
  visible but inactive until Phase B wires up a real SMS provider (none set up yet), at which
  point it'll route to whichever phone number (`workPhone`/`personalPhone`) the employee already
  has saved on the Personal tab, same "their existing profile field, not a new one" rule the
  email side already follows.
- **Clock-in reminders** — once a `Shift` is `UPCOMING` for today, it gets a one-time "your shift
  starts soon" email 30 minutes before its start time (`src/lib/clockin-reminders.ts`), same
  Resend setup as the clock-out reminder email above, skipped (but still marked so it's not
  re-checked) for anyone who's turned `notifyClockInEmail` off. Replaces the older
  `shift-reminders.ts`/`/api/cron/shift-reminders` (Oct 2026) — that version was keyed on
  `AvailabilitySubmission` instead of `Shift`, and since converting a submission to a shift never
  changed the submission's own `APPROVED` status, a converted shift could get double-reminded by
  both systems at once. Runs from `POST /api/cron/clockin-reminders`, hit every 15 minutes the
  same way `/api/cron/clockout-reminders` and `/api/cron/auto-clockout` are (same shared
  `CRON_SECRET`) — independent jobs, not one combined schedule, so any one can be paused without
  affecting the others. Comparing "is it within 30 minutes of this shift's start time" needs an
  actual timezone (unlike the clock-out jobs, which only measure elapsed duration), hardcoded to
  `America/New_York` (`ORG_TIMEZONE` in `src/lib/time.ts`) per CB confirming that's where TTC's
  shifts are.
- **Add to Calendar** — My Schedule (CB, Oct 2026: "once it's approved they could get... like if
  they have the iPhone and they could add it to their calendar"). Not a real push notification
  (impossible from a website without an installed App Store app) — instead, each `UPCOMING`
  shift's card gets an "Add to Calendar" button that downloads a one-event `.ics` file for that
  single shift (`src/lib/ics.ts`'s `buildIcsEvent`, served from `GET
  /api/shifts/[shiftId]/ics`). iOS Safari recognizes the `text/calendar` response and opens its
  native "Add to Calendar" confirmation sheet directly; the same file works the same way on
  Android and desktop calendar apps too. Self-only and one shift at a time, confirmed via
  `AskUserQuestion` — no whole-week batch export.
- **Availability cutoff reminders** — CB, Oct 2026, following up on the in-app "submit your
  availability for next week" banner (`AvailabilityView.tsx`'s `showCutoffReminder`, Thursday
  through Saturday, visible only to someone with the Availability page actually open): "we're
  supposed to send out that reminder to make their schedule on Sunday... I want to make sure
  that's working properly." `src/lib/availability-cutoff-reminders.ts` is the email
  counterpart — same Thursday-through-Saturday window (`ORG_TIMEZONE`, same reason the clock-in
  reminder needs a real timezone) and the same "has this person submitted anything covering next
  week yet" check, just run against every active employee rather than whoever's looking at the
  page. One email per person per upcoming week (not a daily nag), skipped — but still marked, so
  it isn't re-checked all week — for anyone who's turned `notifyAvailabilityCutoffEmail` off.
  Dedup is `Employee.lastAvailabilityCutoffReminderWeek` (the upcoming week's own Sunday date
  key) rather than a timestamp, since there's no single per-week row anywhere in this schema to
  stamp one on. Runs from `POST /api/cron/availability-cutoff-reminders`, same 15-minute schedule
  and shared `CRON_SECRET` as the other reminder-style jobs.
- **Announcement notifications** — My Profile > Notifications (Oct 2026): posting an
  announcement notifies (and, per that recipient's preference, emails) everyone it's actually
  targeted at, once it's actually visible to them. `Announcement.publishDate` can be future-dated
  (an admin can schedule a post ahead), so `src/lib/announcement-notifications.ts` runs as its
  own cron rather than notifying at creation time — it finds every announcement whose
  `publishDate` has passed and hasn't been notified yet, resolves Everyone/Departments/Employees
  the same way the employee-facing feed already does, and writes one `Notification`
  (`ANNOUNCEMENT_POSTED`) per recipient, stamping `Announcement.notifiedAt` so a later run never
  double-notifies the same post. Runs from `POST /api/cron/announcement-notifications`, same
  15-minute schedule and shared `CRON_SECRET` as the other reminder-style jobs.
- **Notification emails** — CB, Sept 2026: "we need to make sure that any notification goes to
  their email as well so they know." Rather than teaching every one of the in-app notification
  system's `NotificationType` call sites (`src/lib/shifts.ts`, `availability.ts`,
  `pto-actions.ts`, `date-tasks.ts`, and — as of Oct 2026 — `direct-messages.ts` and
  `announcement-notifications.ts`; see `writeNotification` in `src/lib/notifications.ts`) to
  also send its own email, `src/lib/notification-emails.ts` emails whatever `writeNotification`
  already wrote: the same title/body text a person sees in the header bell's feed, reused as-is
  for the email subject/body. The two Oct 2026 types (`ANNOUNCEMENT_POSTED`, `MESSAGE_RECEIVED`)
  are the only ones this job checks a preference for first (`notifyAnnouncementEmail`/
  `notifyMessageEmail` above) — every other type is still emailed unconditionally, exactly as
  before. Runs async from the real action, same shared Resend setup as the other reminder emails
  above — deliberately NOT sent inline from inside `writeNotification`'s own transaction, since
  that already runs inside the same transaction as the real mutation it's a side effect of, and
  blocking that open on an external HTTP call would reopen the connection-pool-exhaustion problem
  `withConnectionLimit()` (`src/lib/db.ts`) was hotfixed for. Tracked by `Notification.emailedAt`
  (null until sent — or skipped by preference — stamped once, never touched again) so a later
  run never double-sends. Runs from `POST /api/cron/notification-emails`, same 15-minute schedule
  and shared `CRON_SECRET` as the other reminder-style jobs.
- **Task review reminders** — CB, Oct 2026, round two: "we get some reminders to approve their
  tasks... I don't want them to forget." `DATE_TASK_SUBMITTED` (above) only ever fires once, right
  when an employee submits a task — nothing followed up if it just sat there. `src/lib/date-task-
  reminders.ts` closes that gap: once a task's been `AWAITING_REVIEW` for 24 hours, and once a day
  again for as long as it keeps sitting there unreviewed, it re-notifies (and emails, same as every
  other operational type) the exact same reviewers (admins plus that employee's own supervisor) the
  original submit notification already went to, via the same `resolveTaskReviewerIds` lookup
  (`src/lib/date-tasks.ts`). `DateTask.lastReviewReminderAt` tracks the last one sent so a task
  that's just been approved or returned simply stops matching and the nagging stops on its own —
  no separate "cancel the reminder" step needed. Runs from `POST /api/cron/date-task-reminders`,
  same 15-minute schedule and shared `CRON_SECRET` as the other reminder-style jobs.
- **Scheduled messages** — "Schedule message" (Sept 2026, part of the reply-chain redesign):
  composing a DM lets you pick a future date/time instead of sending right away
  (`src/lib/direct-messages.ts`'s `postMessage`/`sendDueScheduledMessages`). A scheduled message
  is invisible to everyone — including the sender's own normal thread view — until it actually
  goes out; the sender manages what's still pending from a dedicated "Scheduled" list in the
  thread instead (with a Cancel option, `DELETE /api/messages/dm/[employeeId]/scheduled/
  [messageId]`, only while it hasn't gone out yet). No timezone concept needed server-side (unlike
  shift reminders): the picker is a plain `datetime-local` input, so it's always whatever
  timezone the sender's own browser is in. Runs from `POST /api/cron/scheduled-messages`, same
  schedule and `CRON_SECRET`-protected shape as the three jobs above — a message scheduled for,
  say, 3:00 PM goes out sometime within that run's 15-minute window, not necessarily on the exact
  minute.
- **What actually calls those eight cron endpoints on a schedule** — a GitHub Actions workflow
  (`.github/workflows/reminder-emails.yml`), not a Render Cron Job: Render's Cron Jobs have no
  free tier, and this repo already lives on GitHub, so a scheduled Action reuses an account
  that already exists rather than adding a new paid resource. It needs a repository secret
  named `CRON_SECRET` — Settings -> Secrets and variables -> Actions -> New repository secret —
  set to the exact same value as the `CRON_SECRET` in the Render web service's own environment
  (see `.env.example`), or every run gets a 401. GitHub disables a scheduled workflow after 60
  days with no commits to the repo at all, so if reminders quietly stop going out, check the
  Actions tab for a "disabled" banner on this workflow before assuming the app itself broke.
- **Data model** — the full schema for every Phase 1 module (`prisma/schema.prisma`), even
  though only Time & Attendance, PTO, Documents, Onboarding, Directory, Announcements, and the
  payroll hours export have UI/API built on top of it yet.
- **Two independent authorization layers** — every API route checks permissions in code
  (`src/lib/authorization.ts`), and Postgres Row-Level Security policies
  (`prisma/rls.sql`) enforce the same rules again at the database layer, so a bug in one
  doesn't expose data the other was supposed to catch.

## What's NOT built yet

Administration (`/admin/administration`) covers department management only (see "What's built
so far" above) — it deliberately doesn't invent org-wide settings nothing else in the app reads
yet (a company name, a timezone, a pay-period start day, roles/permissions config beyond what's
already enforced in code and RLS). If a real need for one of those shows up, it's a small
addition to an already-built page rather than a new one.

A team member's login email can't be changed from the Team Members page — that would also require
updating their linked Supabase Auth account to match, which isn't wired up yet; see
`scripts/set-password.mjs` and `ADMINISTRATOR_INSTRUCTIONS.md` for the closest existing
workaround (setting a password directly), and ask whoever manages the Supabase project for an
email change in the meantime.

See **`ADMINISTRATOR_INSTRUCTIONS.md`** for the full HR/Super Admin walkthrough of everything
that IS built.

## Getting set up

> **A live Supabase project already exists for this app** (`chocolatebambooproductions@gmail.com's
> Project`, region `ca-central-1`) — schema deployed, RLS applied and audited (see "Security
> notes"), storage bucket created. Steps 1-2 below are already done for that project; ask CB for
> the connection values (project URL, anon key, and the `app_user` database password) rather than
> re-running them against the same project. Follow steps 1-2 as written only if you're standing up
> a *separate* environment (e.g. staging) from scratch.

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
- `MIGRATE_DATABASE_URL` — the elevated `postgres` connection string, used only by the
  `npm run db:migrate` / `db:deploy` scripts below (never by the deployed app, and never
  directly by `prisma/schema.prisma` — its datasource always points at `DATABASE_URL`; see
  `scripts/migrate.mjs` for how the swap happens).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase Project
  Settings → API.
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Project Settings → API → `service_role`
  secret. Server-only: never prefix it with `NEXT_PUBLIC_`, never send it to the browser.
  It's what lets the app upload documents and mint signed download URLs (see "Document
  storage bucket" below) — it bypasses Supabase's own access rules entirely, so the app's own
  authorization check in `src/lib/documents.ts` is the only thing standing between an
  team member and someone else's document.
- `SITE_URL` — the app's own real deployed URL. See "Site URL (invite emails)" just below —
  it has to match a Supabase dashboard setting, not just this env var.

### 3a. Site URL (invite emails)

In the Supabase dashboard, go to Authentication → URL Configuration and set **Site URL** to
your app's real deployed URL (e.g. `https://ttc-hr-portal.onrender.com`) — **not**
`http://localhost:3000`, which is what a brand-new Supabase project defaults to. Also add that
same URL (with a trailing `/**`, e.g. `https://ttc-hr-portal.onrender.com/**`) under **Redirect
URLs** on the same page — Supabase silently ignores any `redirectTo` that isn't on this
allow-list and falls back to the Site URL default instead, so both settings matter, not just
one.

Then set the `SITE_URL` environment variable (see step 3 above) to that same URL. The app uses
it to build the link inside every invite and resend-invite email
(`src/lib/employees-admin.ts`'s `inviteRedirectUrl`) — skip this step and every invite link
sends real people to `localhost:3000` on their own machine, which is exactly the bug CB hit in
production (Sept 2026): the email arrives, looks fine, and the link goes nowhere useful. If
`SITE_URL` isn't set, invite/resend-invite now fails with a clear error instead of silently
sending a broken link.

### 3b. Document storage bucket

In the Supabase dashboard, go to Storage and create a new bucket named exactly `documents`.
**Leave "Public bucket" unchecked** — a public bucket would make every uploaded document
readable by anyone who guesses or intercepts a URL, bypassing every authorization check this
app makes. The app never talks to this bucket with a user's own session; it always goes
through the service-role key from a server route, after `src/lib/documents.ts` has already
confirmed (via Postgres RLS, under that specific team member's identity) that they're allowed to
see the document in question.

### 3c. Profile photo bucket

In the Supabase dashboard, go to Storage and create a new bucket named exactly `avatars`.
**Check "Public bucket" this time** — the opposite choice from `documents` above. A profile
photo isn't a confidential HR record the way a signed offer letter or W-4 is, and it needs to
render as a plain `<img src>` in team member lists without minting a fresh signed URL for every
row on every page load. Who may SET a photo is still fully gated at the app layer (the
`assertIsAdmin()` check in `/api/admin/employees/[id]/photo`) — this bucket only controls who
can *read* a photo once one exists, which for a headshot on an internal HR portal is fine to
be "anyone with the exact URL."

### 4. Install, migrate, run

```bash
npm install                        # also runs `prisma generate` via postinstall
npm run db:migrate -- --name init  # uses MIGRATE_DATABASE_URL — see scripts/migrate.mjs
# then re-run prisma/rls.sql in the Supabase SQL editor (step 2) against the fresh tables
npm run dev
