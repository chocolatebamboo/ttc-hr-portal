-- CreateTable
CREATE TABLE "TimeSession" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeSession_timeEntryId_idx" ON "TimeSession"("timeEntryId");

-- AddForeignKey
ALTER TABLE "TimeSession" ADD CONSTRAINT "TimeSession_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: every existing TimeEntry's clockIn/lunchStart/lunchEnd/clockOut is split into
-- TimeSession rows before those columns are dropped below, so no real logged time is lost in
-- the move from a fixed four-field day to an open-ended list of clock-in/clock-out pairs.
--
-- A day with a lunch break (lunchStart set) becomes two sessions: clockIn->lunchStart, and
-- (only once lunchEnd is also set) lunchEnd->clockOut. A day without a lunch break becomes one
-- session: clockIn->clockOut. Either half of a pair can be NULL (an entry that's still
-- mid-shift at migration time, or was left mid-lunch) — that's carried over as-is, since NULL
-- clockOut on the newest session is exactly how "currently clocked in" is represented now.
INSERT INTO "TimeSession" ("id", "timeEntryId", "clockIn", "clockOut", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "clockIn",
  CASE WHEN "lunchStart" IS NOT NULL THEN "lunchStart" ELSE "clockOut" END,
  "createdAt", "updatedAt"
FROM "TimeEntry"
WHERE "clockIn" IS NOT NULL;

INSERT INTO "TimeSession" ("id", "timeEntryId", "clockIn", "clockOut", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "lunchEnd", "clockOut", "createdAt", "updatedAt"
FROM "TimeEntry"
WHERE "lunchEnd" IS NOT NULL;

-- Recompute totalMinutes from the new sessions — the sum of every closed session's
-- (clockOut - clockIn), in whole minutes — matching computeTotalMinutes in src/lib/time.ts,
-- rather than trusting the old column's value to already agree with it.
UPDATE "TimeEntry" e
SET "totalMinutes" = COALESCE(sub.minutes, 0)
FROM (
  SELECT "timeEntryId", ROUND(SUM(EXTRACT(EPOCH FROM ("clockOut" - "clockIn"))) / 60)::int AS minutes
  FROM "TimeSession"
  WHERE "clockOut" IS NOT NULL
  GROUP BY "timeEntryId"
) sub
WHERE e."id" = sub."timeEntryId";

-- A day whose only session(s) are still open (no clockOut at all yet) isn't covered by the join
-- above — give it 0 rather than leaving whatever the old column happened to hold, matching
-- computeTotalMinutes's "0 while nothing has closed yet" behavior going forward.
UPDATE "TimeEntry" e
SET "totalMinutes" = 0
WHERE EXISTS (SELECT 1 FROM "TimeSession" s WHERE s."timeEntryId" = e."id")
  AND NOT EXISTS (SELECT 1 FROM "TimeSession" s WHERE s."timeEntryId" = e."id" AND s."clockOut" IS NOT NULL);

-- A day with no sessions at all (clockIn was already null on that row) keeps totalMinutes NULL,
-- same "nothing logged" meaning formatHoursCompact/formatMinutes already give that value.

-- AlterTable
ALTER TABLE "TimeEntry" DROP COLUMN "clockIn",
DROP COLUMN "lunchStart",
DROP COLUMN "lunchEnd",
DROP COLUMN "clockOut";
