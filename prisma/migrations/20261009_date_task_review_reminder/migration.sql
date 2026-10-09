-- CB, Oct 2026, round two: "we get some reminders to approve their tasks... I don't want them
-- to forget." submitDateTask (src/lib/date-tasks.ts) already notifies every reviewer once, right
-- at submit time (DATE_TASK_SUBMITTED, added earlier this same week) — but that's a one-shot: if
-- it sits in AWAITING_REVIEW past that, nothing ever follows up. src/lib/date-task-reminders.ts's
-- new cron job closes that gap: once a task's been awaiting review for 24 hours, and once a day
-- again for as long as it keeps sitting there, it re-notifies the same reviewers
-- resolveTaskReviewerIds already resolves for the original submit notification.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`).
--
-- No RLS change needed: date_task_write (prisma/rls.sql) is row-level only ("is this employeeId's
-- row, or one you supervise/administer"), not a column allow-list, so this new column passes
-- through the existing policy untouched — same reasoning as submissionNote's own migration. The
-- cron job itself writes through a SUPER_ADMIN SYSTEM_ACTOR, same as every other reminder job in
-- this app (clockout-reminders.ts, clockin-reminders.ts), which is_admin() already covers.
ALTER TABLE "DateTask" ADD COLUMN "lastReviewReminderAt" TIMESTAMP(3);

-- Emailed unconditionally once added (not listed in notification-emails.ts's
-- PREFERENCE_BY_TYPE) — same reasoning as DATE_TASK_SUBMITTED's own migration.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DATE_TASK_REVIEW_REMINDER';
