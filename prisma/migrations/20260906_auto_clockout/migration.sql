-- CB (Sept 2026): "if you didn't clock out... it should automatically clock you out after,
-- like, I would say, three hours, four hours max. because I forgot to clock out last night,
-- and it went over twelve hours, and then it documented it to be twelve hours. I don't
-- necessarily want that because that's not necessarily true." Backs the new auto-clockout job
-- (src/lib/auto-clockout.ts): a session still open 4 hours after clocking in gets force-closed
-- at exactly the 4-hour mark and the day is flagged AWAITING_APPROVAL so a supervisor sees it
-- and can correct the real time if needed, rather than letting an unnoticed open session quietly
-- rack up whatever hours pass before someone happens to clock out.
--
-- New TimeAuditAction value, so the audit trail can say *why* a clockOut was set (the system,
-- not the team member) — same additive, IF NOT EXISTS pattern as the 20260905 CANCELLED
-- migration, applied directly to production first via the Supabase SQL editor/MCP so the
-- feature could ship immediately, with this file landing in git for the normal history and for
-- a later fresh-database `prisma migrate deploy` to pick up as a no-op.
ALTER TYPE "TimeAuditAction" ADD VALUE IF NOT EXISTS 'AUTO_CLOCK_OUT';

-- TimeEntryAuditEvent.actorId becomes optional, mirroring AvailabilitySubmission.reviewedById's
-- existing nullable pattern: every audit row up to now has had a real signed-in employee behind
-- it (whoever clocked in/out, or a supervisor/HR reviewing), but an AUTO_CLOCK_OUT row is the
-- system acting on a stale session with nobody signed in to attribute it to. Checked against
-- every reader of TimeEntryAuditEvent in src/ (src/app/api/time/timesheet/route.ts and
-- src/lib/time-actions.ts) — none of them select or render the `actor` relation, only
-- `.action`/`.comment`, so there's no UI that needs null-safety added for this.
ALTER TABLE "TimeEntryAuditEvent" ALTER COLUMN "actorId" DROP NOT NULL;
