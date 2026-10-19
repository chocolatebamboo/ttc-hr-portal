-- CB, Oct 2026, on a flagged double-clock-in that recorded 0h 00m: "we should have the option to
-- adjust the time and manually edit the time just in case those were cases for it but remember
-- only Shawn and I am supposed to be able to have those types of capabilities."
--
-- A standing, per-person flag rather than hardcoding employee ids in source — same shape as
-- Employee.clocksIn (20260927_employee_clocks_in) and Employee.isAvailabilityReviewer
-- (20261004_availability_reviewer_flag): independent of role, toggled per person, NOT NULL with a
-- DEFAULT of false so nothing changes for anyone else until it's turned on.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`), including
-- the UPDATE below setting it true for CB and Shawn's existing rows.
--
-- No RLS change needed: same reasoning as clocksIn/isAvailabilityReviewer's own migrations —
-- enforce_employee_self_update() (prisma/rls.sql) is a deny-list of admin-only columns, not an
-- allow-list, so this new column passes through it untouched, and there's no self-service API
-- route exposing it either. The new /api/time/entries/[id]/hr-correct route enforces this flag
-- itself server-side via assertCanEditFlaggedTimeEntries (src/lib/authorization.ts), same as
-- every other reviewer-only action in this app.
ALTER TABLE "Employee" ADD COLUMN "canEditFlaggedTimeEntries" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Employee" SET "canEditFlaggedTimeEntries" = true WHERE id IN (
  '9bc10989-c06e-43f7-a6ef-7be15c4eaa21', -- Chocolate Bamboo (CB), HR Director, SUPER_ADMIN
  '46a4c8e5-b310-4dcb-b1f5-642ef4bfccdf'  -- Shawn Ho-Hing
);
