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
- Tables that scroll sideways on a narrow phone screen (the supervisor's per-employee timesheet
  review page, in particular) are an intentional design choice, not a layout bug — the columns
  are all there if you scroll. My Time itself is a month calendar and doesn't have this tradeoff.

## Workflow checklist

Everyone should do the "Every account" section first, then their role-specific section. This
roughly follows the module order the app was built in, which is also a reasonable order to test
it in — each step depends on data the previous one created (an employee submits a timesheet
before their supervisor can approve it, for instance), so the Employee and Supervisor testers
will need to coordinate timing loosely (e.g., "I submitted my hours, go ahead and review them").

### Every account

- [ ] Open the invite email, set a password, sign in at the real deployed URL (not localhost).
- [ ] Sign out and sign back in — confirms the session actually persists correctly.
- [ ] If Google sign-in is turned on (README "Getting set up" §9), sign out and try "Continue
      with Google" using the same email the invite went to — it should land you straight on the
      Dashboard, no separate approval step. If you have a Google account with a *different*
      email than any invited employee, confirm trying that one bounces back to `/login` with a
      clear "ask HR" message instead of a broken page.
- [ ] Check the Directory — find at least one coworker, confirm their listed title/email/phone
      looks right, confirm you do *not* see anyone's personal phone, personal email, or
      emergency contact (those are intentionally admin/self-only).
- [ ] Check Announcements — read anything already posted (see the HR Admin section below for
      posting one first).
- [ ] Try this on your phone, not just a laptop — at least the Dashboard and My Time pages.
      This app is meant to work well on a phone; a pilot that's only ever run on a laptop
      won't catch what a phone catches.

### Employee(s)

- [ ] Clock in and out more than once in the same day from the Dashboard's time clock card (e.g.
      clock in, clock out for a break, clock back in, clock out again) — confirm each session
      shows up in the running list and "Hours today" adds them together. Do this for at least two
      different days. Then check My Time (now a month calendar) — click on one of those days and
      confirm every session and the total hours match what you just did.
- [ ] On My Time, scroll down past the bottom of the current month — confirm the previous month
      loads in and appends automatically (no button or arrow to click), and keep scrolling to
      confirm it keeps loading further back. On a laptop, also confirm the calendar itself fills
      most of the page width rather than sitting in a narrow column with empty space beside it.
- [ ] Clock-out reminder (needs RESEND_API_KEY/CRON_SECRET set and the Render Cron Job running —
      skip this one if that setup hasn't happened yet): clock in, then either wait 3+ hours or,
      faster, edit the row's `clockIn` directly in Supabase to something 3+ hours in the past.
      Within one cron interval, confirm the reminder email arrives, and reload the Dashboard to
      confirm the amber "you've been clocked in for..." banner shows on the time clock card.
      Clock out and confirm the banner disappears; re-running the cron job again for the same
      session should NOT send a second email.
- [ ] Submit the week's timesheet.
- [ ] On My Time, click a day (today or any day after) that has nothing logged and submit a
      one-day time-off request right from there — confirm it shows up both on that calendar
      day (in place of an hours readout) and in the "Your time-off requests" list below the
      calendar on the same page.
- [ ] On My Time, click one empty eligible day, then click a different empty eligible day near
      it to select the whole run between them — confirm the panel updates to cover every day
      in between and submitting creates one multi-day request (not several). Also confirm you
      can still see and click days elsewhere on the calendar while the panel is open (it
      shouldn't block or dim the calendar underneath it) — on a phone specifically, confirm the
      panel is a small floating card (not a sheet covering most of the screen) and that it
      doesn't cover the bottom tab bar.
- [ ] Use "Request for another date" below the calendar to submit a PTO request for a past
      date (or a date several months out) — confirm it shows up in the list the same way.
- [ ] Cancel a *different* PTO request you haven't submitted for approval yet, to confirm
      cancel works before a supervisor acts on it — try this once from the request list and
      once from clicking that day on the My Time calendar, since both lead to the same cancel
      action.
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
      can see the outcome and your comment — including on My Time itself, where that day's
      calendar marker should update to match (green for Approved, red for Denied).
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
- [ ] Add a Certification step to one pilot Employee's checklist (or a template) and have them
      reach it: confirm the full New Hire Excellence Certification Test renders inline as their
      current step, Submit is disabled until every question has an answer, and submitting moves
      the step to Awaiting Approval. Open **Review Test** on their Manage row and confirm the
      auto-scored questions already show Correct/Incorrect; grade the remaining open-ended ones
      as Meets/Does Not Meet with a comment. Confirm **Approve** is refused with a clear reason
      before grading is finished, and again if the final score lands under 85% (use **Return**
      instead, then confirm the employee can retake it and the earlier attempt stays visible
      under Review Test as history). Finally, open **Manage Certification Test**, edit one
      question's answer key (e.g. add a program name to "Name three TTC programs"), and confirm
      it saves without a code change or redeploy.
- [ ] Open the Reports page and click "This week" or "This month," or pick a date range that
      covers what the Employee testers submitted, then download the Payroll Hours CSV. Open it
      and sanity-check the numbers against what was actually clocked and approved (including any
      day with multiple clock-in/out sessions — the hours should be the sum of all of them).
      Confirm the "still awaiting approval" warning shows up if anything in range hasn't been
      approved yet.
- [ ] On the same Reports page, use the Employee picker to narrow the report to one pilot
      tester — confirm the preview table and the CSV both show only that person's row (and the
      CSV filename reflects it), then switch back to "All employees" and confirm the full table
      returns.
- [ ] Open Employees — confirm every pilot tester shows up with the right role, department, and
      supervisor. Edit one person's job title or department and confirm it saves.
- [ ] From Employees, add one more person (a throwaway test account you control) with **Add
      Employee** and confirm the invite email arrives — this is now the in-app alternative to
      running `scripts/create-pilot-accounts.mjs` from a terminal.
- [ ] Deactivate that throwaway account from Employees and confirm they're immediately signed
      out / blocked on their next request — then Reactivate them and confirm they're back in.
      Also confirm you can't deactivate your own account from here.
- [ ] As a Super Admin, click **View as** on the Employee or Supervisor pilot tester and confirm
      the nav, dashboard, and their real data all render exactly as that person would see them,
      with an amber "Previewing as…" bar across the top. Confirm every submit/approve/clock-in
      type action is genuinely blocked (not just hidden) while previewing, then use **Exit
      preview** to get back to your own account. Confirm you do NOT see "View as" at all when
      signed in as the HR Admin pilot tester — it's Super Admin only.
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
