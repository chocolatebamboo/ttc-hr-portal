-- CB, Oct 2026: "for Shawn and Daijour let's make sure that they get a notification... the team
-- member selects their schedule and it's ready to be approved... I want an email to be sent out
-- to them." resolveAvailabilityReviewerIds (src/lib/availability.ts) already notifies every
-- SUPER_ADMIN/HR_ADMIN plus the submitter's own supervisor for every availability submission —
-- Shawn (HR_ADMIN) was already covered, but Daijour (SUPERVISOR) only heard about it when he
-- happened to be that specific submitter's supervisor, not for the team as a whole.
--
-- A standing, per-person flag rather than hardcoding employee ids in source — same shape as
-- Employee.clocksIn (20260927_employee_clocks_in): independent of role, toggled per person,
-- NOT NULL with a DEFAULT of false so nothing changes for anyone else until it's turned on.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`), including
-- the UPDATE below setting it true for Shawn and Daijour's existing rows.
--
-- No RLS change needed: same reasoning as clocksIn's own migration — enforce_employee_self_update()
-- (prisma/rls.sql) is a deny-list of admin-only columns, not an allow-list, so this new column
-- passes through it untouched, and there's no self-service API route exposing it either.
ALTER TABLE "Employee" ADD COLUMN "isAvailabilityReviewer" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Employee" SET "isAvailabilityReviewer" = true WHERE id IN (
  '46a4c8e5-b310-4dcb-b1f5-642ef4bfccdf', -- Shawn Ho-Hing (already covered via HR_ADMIN role, set explicitly too so it survives a future role change)
  '1f34ca77-0fbc-4704-87de-36ca1c279769'  -- Daijour Ho-Hing (SUPERVISOR role — this is the actual gap being closed)
);
