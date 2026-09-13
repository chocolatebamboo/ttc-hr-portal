-- Phase 3 (client spec, Sept 2026): "clock-in gated to scheduled shifts with a 15-minute
-- window and exception-reason flagging." shiftId records which Shift (if any) a given clock-in
-- matched against; isException/exceptionReason record whether that clock-in fell outside the
-- window (or had no shift at all) and, if so, why. See TimeSession's own doc comment in
-- prisma/schema.prisma and resolveClockInShift/applyClockAction in src/lib/time-actions.ts.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`).
ALTER TABLE "TimeSession"
  ADD COLUMN "shiftId" TEXT,
  ADD COLUMN "isException" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "exceptionReason" TEXT;

ALTER TABLE "TimeSession"
  ADD CONSTRAINT "TimeSession_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX "TimeSession_shiftId_idx" ON "TimeSession"("shiftId");
