-- Phase 2 of the scheduling/attendance/task workflow rebuild (client spec, Sept 2026): additive
-- columns/enum value for "Request Shift Change" / "Request Cancellation" (Shift) and the
-- supervisor's "Adjust the proposed time and send it to the team member for confirmation"
-- (AvailabilitySubmission). Nothing here is destructive — no column removed or renamed, no
-- existing row rewritten.

ALTER TABLE "Shift" ADD COLUMN "requestedAt" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Shift" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "reviewComment" TEXT;

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Shift_reviewedById_idx" ON "Shift"("reviewedById");

-- New reviewer decision on AvailabilitySubmission, alongside the existing Approved/Denied —
-- see AvailabilityStatus's own doc comment in prisma/schema.prisma.
ALTER TYPE "AvailabilityStatus" ADD VALUE 'ADJUSTMENT_REQUESTED';

ALTER TABLE "AvailabilitySubmission" ADD COLUMN "adjustedSlots" JSONB;
