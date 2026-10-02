-- CB, Oct 2026: "I kind of want a notifications tab... they could toggle on which notifications
-- that they could have... by default... email sent to them, reminding them that it's time to
-- clock in and time to clock out... if we get an announcement or if we get a message, those are
-- notifications too... I want it to be between email and phone number... make sure that it's
-- whichever number attached to their profile or email." Phase A (confirmed via AskUserQuestion:
-- "Email now, text later") — this migration is the email-only half; the Text-message toggle
-- shown in the approved mockup stays visually present but non-functional until Phase B adds real
-- SMS delivery (a new provider/account, not yet set up).
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`).
--
-- Four self-service preference booleans on Employee, defaulting true so every existing employee
-- keeps getting exactly the emails they already silently got before this feature existed (clock-
-- in/out reminders already existed; announcement/message emails are new, see below) until they
-- turn one off themselves from My Profile > Notifications. No RLS change needed:
-- enforce_employee_self_update() (prisma/rls.sql) is a deny-list of admin-only columns, not an
-- allow-list, so these four new self-service columns already pass through it untouched.
ALTER TABLE "Employee" ADD COLUMN "notifyClockInEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Employee" ADD COLUMN "notifyClockOutEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Employee" ADD COLUMN "notifyAnnouncementEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Employee" ADD COLUMN "notifyMessageEmail" BOOLEAN NOT NULL DEFAULT true;

-- Dedup column for the new Shift-based clock-in reminder (src/lib/clockin-reminders.ts), same
-- one-shot-per-thing shape as TimeSession.reminderSentAt (clockout-reminders.ts). This replaces
-- shift-reminders.ts's older AvailabilitySubmission-keyed reminder, which convert-to-shift never
-- cleared — a shift converted from an approved submission could get BOTH the old reminder (still
-- keyed on the submission's own unchanged APPROVED status) and a new one, double-emailing the
-- same person about the same shift. shift-reminders.ts (and its cron route/GH Actions step) is
-- being retired in this same delivery now that Shift, not AvailabilitySubmission, is this app's
-- real source of scheduling truth.
ALTER TABLE "Shift" ADD COLUMN "clockInReminderSentAt" TIMESTAMP(3);

-- Cron-gate column for the new announcement-notification dispatcher (new
-- src/lib/announcement-notifications.ts): Announcement.publishDate can be future-dated (admins
-- can schedule a post ahead), so notifying/emailing at createAnnouncement() call time would be
-- premature for anything not published yet. A separate cron finds publishDate <= now() AND
-- notifiedAt IS NULL, writes one Notification per matched recipient, and stamps this — same
-- shape as every other dedup column in this migration.
ALTER TABLE "Announcement" ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- Two new NotificationType values for the two new always-in-app-plus-optionally-emailed events.
-- sendPendingNotificationEmails (src/lib/notification-emails.ts) stays type-agnostic for the 12
-- existing values (always emailed, as today) and gets a small type-conditional check added ONLY
-- for these two, gating on the recipient's new notifyAnnouncementEmail/notifyMessageEmail above.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_POSTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MESSAGE_RECEIVED';
