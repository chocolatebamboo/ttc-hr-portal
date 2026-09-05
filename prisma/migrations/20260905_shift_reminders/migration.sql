-- New table tracking which (AvailabilitySubmission, date) pairs have already had a "your
-- shift starts soon" reminder email sent — CB, Sept 2026, after the calendar/history rework:
-- once an availability submission is approved, send a heads-up email 30 minutes before each
-- date's start time. A submission can cover several dates at once (slots is a JSON array on
-- AvailabilitySubmission), so this needs its own per-date tracking rather than a single column
-- on that table — see src/lib/shift-reminders.ts.

-- CreateTable
CREATE TABLE "AvailabilityShiftReminder" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityShiftReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityShiftReminder_submissionId_date_key" ON "AvailabilityShiftReminder"("submissionId", "date");

-- AddForeignKey
ALTER TABLE "AvailabilityShiftReminder" ADD CONSTRAINT "AvailabilityShiftReminder_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AvailabilitySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
