# Pilot testing runbook (roadmap step 12)

Five real accounts — one HR/Super Admin, one Supervisor, two or three Employees who report to
that Supervisor — running the actual workflows this app replaces from BambooHR, on a real
deployment, before this goes live for everyone. This isn't a demo script; it's the last check
that catches whatever a solo build-and-mock-test cycle can't: real email deliverability, real
mobile devices and browsers, and a supervisor and employees who don't already know where every
button is.

## Before you start

1. Follow the README's "Getting set up" section end to end: Supabase project created, the
   restricted `app_user` role and RLS policies applied, environment variables set, the app
   deployed somewhere real (not just `localhost`) with the `hr.` subdomain pointed at it.
2. Edit `scripts/create-pilot-accounts.mjs` — replace every `REPLACE_ME` with the real name and
   email of each pilot tester. The script refuses to run while any placeholder remains, on
   purpose, since running it sends real invite emails.
3. Run `npm run pilot:create-accounts`. Each person gets a Supabase invite email with a link to
   set their own password — nobody else ever sees or sets a real password for them. Re-running
   the script later (to add a third employee, fix a typo, etc.) is safe: it updates existing
   rows instead of duplicating them.
4. Send each pilot tester the deployed URL and tell them to expect the invite email (check spam
   the first time — new sending domains sometimes land there).
5. Agree on where they'll report issues — a shared doc, a Slack thread, whatever's easiest. Ask
   for specifics: what they clicked, what they expected, what happened, and their device/browser
   if it looks visual. "Something's off on the Time page" is much harder to act on than "on my
   phone, the Approve button was cut off on the Team review page."

## What NOT to report as a bug

The README's "What's NOT built yet" list is current — worth skimming before the pilot starts so
these don't get reported as surprises:

- The `/admin/administration` page only manages departments — there's no org-wide settings
  section (company name, timezone, etc.) because nothing else in the app reads one yet.
- An employee's login email can't be changed from the Employees page — that needs a matching
  change on their Supabase Auth account, which isn't wired up yet.
- Tables that scroll sideways on a narrow phone screen (the weekly timesheet, in particular) are
  an intentional design choice, not a layout bug — the columns are all there if you scroll.

## Workflow checklist

Everyone should do the "Every account" section first, then their role-specific section. This
roughly follows the module order the app was built in, which is also a reasonable order to test
it in — each step depends on data the previous one created (an employee submits a timesheet
before their supervisor can approve it, for instance), so the Employee and Supervisor testers
will need to coordinate timing loosely (e.g., "I submitted my hours, go ahead and review them").

### Every account

- [ ] Open the invite email, set a password, sign in at the real deployed URL (not localhost).
- [ ] Sign out and sign back in — confirms the session actually persists correctly.
- [ ] Check the Directory — find at least one coworker, confirm their listed title/email/phone
      looks right, confirm you do *not* see anyone's personal phone, personal email, or
      emergency contact (those are intentionally admin/self-only).
- [ ] Check Announcements — read anything already posted (see the HR Admin section below for
      posting one first).
- [ ] Try this on your phone, not just a laptop — at least the Dashboard, My Time, and Time Off
      pages. This app is meant to work well on a phone; a pilot that's only ever run on a
      laptop won't catch what a phone catches.

### Employee(s)

- [ ] Clock in, take a lunch break, clock out on the My Time page, for at least two different
      days.
- [ ] Submit the week's timesheet.
- [ ] Submit a PTO request (any type — vacation, sick, personal).
- [ ] Cancel a *different* PTO request you haven't submitted for approval yet, to confirm
      cancel works before a supervisor acts on it.
- [ ] Open Documents — acknowledge anything that requires it, confirm you can view/download
      anything assigned to you or company-wide, and confirm nothing marked confidential-HR-only
      is visible to you.
- [ ] Open Onboarding (if HR has started a checklist for you — ask them to) and complete the
      one step it shows as current — a plain task completes right away, but a document/training/
      meeting step submits for approval instead, so confirm it correctly shows "Awaiting
      Approval" and stays locked on the next step until your supervisor or HR approves it below.
- [ ] After your supervisor or HR approves that step (below), confirm — without you doing
      anything else — that a small dot shows up on the Onboarding nav link (or on "More," on a
      phone) the next time you load any page, and that your Dashboard's "Needs your attention"
      list now points at your next step. Then open it and confirm the dot and Dashboard entry
      both disappear once you act on it.
- [ ] After your supervisor approves your timesheet and decides your PTO request (below),
      come back and confirm the status updated and looks right from your side.
- [ ] Ask your supervisor to **Return** (not approve) one timesheet entry with a comment, then
      confirm you can see that comment and correct/resubmit it.

### Supervisor

- [ ] Do everything in the Employee checklist above first — a supervisor is also an employee
      with their own timesheet and PTO.
- [ ] Open My Team — confirm you see exactly your own reports, not anyone else's.
- [ ] Review and Approve at least one report's timesheet entry.
- [ ] Review and Return at least one report's timesheet entry with a comment (coordinate with
      that employee so they know to check for it and correct/resubmit).
- [ ] Approve one PTO request and Deny a different one with a comment; confirm both requesters
      can see the outcome and your comment.
- [ ] Confirm you can NOT see or act on an employee who is not your report (ask HR to point you
      at someone outside your team, or try guessing a URL for someone else's review page — it
      should refuse you, not show their data).
- [ ] Open Onboarding's Manage tab for one of your reports and **Approve** the step they
      submitted above; confirm it unlocks their next step immediately. On a different report's
      step, **Return** it with a reason instead, and confirm they see the reason and can
      resubmit.
- [ ] Before you approve anything above, confirm your own Onboarding nav dot and Dashboard
      "Needs your attention" list already flagged that a report has a step awaiting your
      approval — this is the same in-app notification an employee sees, just for reviewers.

### HR / Super Admin

- [ ] Post a company-wide Announcement, a department-only one, and one to a single individual;
      confirm each shows up only where it should (ask the Employee/Supervisor testers to check).
- [ ] Upload a Document, assign it (try all three: global, one department, one specific person),
      mark one as requiring acknowledgment, and confirm the right people can see it and the
      wrong people can't.
- [ ] Start an Onboarding checklist for one of the pilot Employees, then add at least one custom
      step of each type beyond the defaults — a plain Task, a Document (pick one that requires
      acknowledgment), and a Training or Meeting step — and confirm the employee only ever sees
      one step "up next" at a time, in order.
- [ ] Under Onboarding's Manage tab, open **Manage Templates** and build a named template (e.g.
      "Camp Counselor") with two or three steps of different types. Start a *different* pilot
      Employee's checklist by picking that template from the dropdown instead of the standard
      starter, and confirm their checklist comes in with exactly those steps, in order, with any
      due-date offsets applied correctly. Then delete the template and confirm that employee's
      already-started checklist is completely unaffected.
- [ ] After starting a checklist above, confirm the Manage tab's roster shows a status pill for
      that employee (Action Needed / Upcoming / Waiting on Employee / Not Started / Completed),
      and that opening Manage on them shows an **Internal Readiness** panel (8 fixed tasks) and a
      **30/60/90-Day Checkpoints** panel (3 fixed milestones) — check one readiness task and one
      checkpoint off, add a note to a checkpoint, and confirm both save. Ask that employee to
      confirm neither panel appears anywhere on their own Onboarding page.
- [ ] Open the Reports page, pick a date range that covers what the Employee testers submitted,
      and download the Payroll Hours CSV. Open it and sanity-check the numbers against what was
      actually clocked and approved. Confirm the "still awaiting approval" warning shows up if
      anything in range hasn't been approved yet.
- [ ] Open Employees — confirm every pilot tester shows up with the right role, department, and
      supervisor. Edit one person's job title or department and confirm it saves.
- [ ] From Employees, add one more person (a throwaway test account you control) with **Add
      Employee** and confirm the invite email arrives — this is now the in-app alternative to
      running `scripts/create-pilot-accounts.mjs` from a terminal.
- [ ] Deactivate that throwaway account from Employees and confirm they're immediately signed
      out / blocked on their next request — then Reactivate them and confirm they're back in.
      Also confirm you can't deactivate your own account from here.
- [ ] As the HR Admin pilot tester (not a Super Admin), confirm you can edit a Super Admin's
      other fields but the Role field is locked with an explanation when it's already Super
      Admin or you try to set it to Super Admin.
- [ ] Open Attendance — confirm it shows every pilot employee for the current week (not just
      one supervisor's team), and that the awaiting-approval / missing-clock-out counts match
      what you'd expect from what the Employee testers actually did.
- [ ] Open PTO Management — confirm the Pending queue shows requests from every pilot employee,
      approve or deny one directly from there, and confirm the Upcoming section lists anything
      already approved with a start date today or later.
- [ ] On a supervisor's per-employee review page (My Team → an employee, or via Attendance),
      submit enough of that employee's days to have more than one Awaiting Approval at once,
      then use "Approve all awaiting" and confirm every one of them updates.
- [ ] On the Documents Manage tab, upload a new version of a document that requires
      acknowledgment; confirm an employee who already acknowledged the old version is asked to
      acknowledge again, and that the version number shown ticks up.
- [ ] Open Administration — add a throwaway department, rename it, confirm the new name shows
      up immediately on that department's employees (check Employees or Directory). Confirm
      Delete is disabled (with an explanation) while an employee is still assigned to it, then
      reassign that employee elsewhere and confirm Delete now works.
- [ ] Everything in the Employee and Supervisor checklists too, since HR can act as either.

## After the pilot

Collect what came back, sort into: real bugs (fix before wider launch), confusing-but-working
(candidates for copy/UI tweaks, not urgent), and feature requests that belong on the roadmap
rather than blocking launch (the two known gaps above will probably come up again here — that's
expected, not new information). Update this file's checklist based on what the pilot actually
revealed was worth testing, so it's useful again for the next round of new hires.
