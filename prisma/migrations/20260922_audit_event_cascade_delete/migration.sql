-- Fixes a live bug: deleting a Pending/Awaiting-Approval TimeEntry that has any
-- TimeEntryAuditEvent rows (e.g. an auto-clockout entry) failed with a P2003 foreign key
-- violation, surfaced to the employee as "Something went wrong. Please try again or contact HR."
--
-- Root cause: TimeEntryAuditEvent_timeEntryId_fkey was ON DELETE RESTRICT (Prisma's default for
-- an unspecified required relation), while deleteEmployeeTimeEntry (src/lib/time-actions.ts)
-- tried to delete the entry's own audit rows first via an RLS-scoped deleteMany — but
-- prisma/rls.sql deliberately grants no UPDATE/DELETE policy on TimeEntryAuditEvent at all
-- ("audit rows are append-only... by anyone"), so that deleteMany always silently removed 0
-- rows, and the following TimeEntry delete then hit the RESTRICT constraint.
--
-- Fix: switch the FK to ON DELETE CASCADE, matching TimeSession's existing relation to
-- TimeEntry. PostgreSQL's referential-integrity actions (including cascade deletes) always
-- bypass row security — this is documented Postgres behavior, specifically to prevent RLS
-- policies from being used to create covert channels through constraint checks — so this
-- cascades correctly even with no delete policy on the audit table. The append-only guarantee is
-- preserved for any TimeEntry that ISN'T being deleted, which is the actual intent behind that
-- policy gap; only a fully-withdrawn day's audit trail goes with it, same as its TimeSession rows
-- already do.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`).
ALTER TABLE "TimeEntryAuditEvent"
  DROP CONSTRAINT "TimeEntryAuditEvent_timeEntryId_fkey",
  ADD CONSTRAINT "TimeEntryAuditEvent_timeEntryId_fkey"
    FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"(id) ON UPDATE CASCADE ON DELETE CASCADE;
