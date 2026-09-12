-- Phase 1 of the scheduling/attendance/task workflow rebuild (client spec, Sept 2026): splits
-- "confirmed shift" out from "approved availability" into its own real record. See Shift's own
-- doc comment in prisma/schema.prisma for the full reasoning.

CREATE TYPE "ShiftStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'CHANGE_REQUESTED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'REASSIGNED', 'MISSED');

CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'UPCOMING',
    "note" TEXT,
    "sourceAvailabilitySubmissionId" TEXT,
    "createdById" TEXT NOT NULL,
    "changeReason" TEXT,
    "requestedDate" TEXT,
    "requestedStartTime" TEXT,
    "requestedEndTime" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "reassignedFromShiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shift_reassignedFromShiftId_key" ON "Shift"("reassignedFromShiftId");
CREATE INDEX "Shift_employeeId_date_idx" ON "Shift"("employeeId", "date");
CREATE INDEX "Shift_employeeId_status_idx" ON "Shift"("employeeId", "status");
CREATE INDEX "Shift_status_idx" ON "Shift"("status");
CREATE INDEX "Shift_date_idx" ON "Shift"("date");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_sourceAvailabilitySubmissionId_fkey" FOREIGN KEY ("sourceAvailabilitySubmissionId") REFERENCES "AvailabilitySubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_reassignedFromShiftId_fkey" FOREIGN KEY ("reassignedFromShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every AvailabilitySubmission that is already APPROVED as of this migration is,
-- today, the only thing the app treats as a "confirmed shift" — converting each of its slots
-- into a real Shift row here means nobody's existing schedule silently disappears the moment
-- this migration lands (CB, confirmed Sept 2026: "auto-convert them... so nobody's existing
-- schedule silently vanishes"). createdById is the submission's own reviewer (who actually
-- approved it) when known, falling back to the employee themselves only in the unlikely case a
-- reviewedById is missing on an already-Approved row. Every backfilled row starts UPCOMING
-- regardless of whether its date has already passed — src/lib/shifts.ts's read-time status
-- derivation (deriveShiftDisplayStatus) is what actually decides Upcoming/In Progress/
-- Completed/Missed for display, exactly as it does for a shift created any other way; this
-- migration never guesses at that.
INSERT INTO "Shift" ("id", "employeeId", "date", "startTime", "endTime", "status", "note", "sourceAvailabilitySubmissionId", "createdById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  sub."employeeId",
  slot->>'date',
  slot->>'startTime',
  slot->>'endTime',
  'UPCOMING',
  sub."note",
  sub."id",
  COALESCE(sub."reviewedById", sub."employeeId"),
  now(),
  now()
FROM "AvailabilitySubmission" sub, jsonb_array_elements(sub."slots") AS slot
WHERE sub."status" = 'APPROVED';
