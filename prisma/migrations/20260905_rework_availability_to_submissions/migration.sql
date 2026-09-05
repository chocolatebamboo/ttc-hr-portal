-- Availability reworked from a single standing weekly pattern (one upserted row per employee)
-- into per-submission records for specific calendar dates (many rows per employee over time,
-- same shape as PtoRequest) — CB, Sept 2026, after seeing the first version: wants the same
-- tap-dates-on-a-calendar experience as My Time, with every decision kept as a record rather
-- than overwriting the one row each time. Confirmed zero rows exist in EmployeeAvailability
-- before writing this (the feature had been live only minutes), so this renames/rebuilds the
-- table in place rather than needing any data migration.

-- RenameTable
ALTER TABLE "EmployeeAvailability" RENAME TO "AvailabilitySubmission";

-- DropIndex (the old one-row-per-employee constraint no longer applies — an employee can now
-- have many submissions). This was created via CREATE UNIQUE INDEX, not ADD CONSTRAINT (see
-- the original 20260905_employee_availability migration), so it has to be dropped as an
-- index — ALTER TABLE ... DROP CONSTRAINT doesn't find it, since Postgres never registered it
-- as a table constraint in the first place.
DROP INDEX "EmployeeAvailability_employeeId_key";

-- RenameForeignKey (cosmetic only — Postgres doesn't require these to match the table name,
-- but keeping them in sync avoids confusion reading the schema later)
ALTER TABLE "AvailabilitySubmission" RENAME CONSTRAINT "EmployeeAvailability_employeeId_fkey" TO "AvailabilitySubmission_employeeId_fkey";
ALTER TABLE "AvailabilitySubmission" RENAME CONSTRAINT "EmployeeAvailability_reviewedById_fkey" TO "AvailabilitySubmission_reviewedById_fkey";
ALTER TABLE "AvailabilitySubmission" RENAME CONSTRAINT "EmployeeAvailability_pkey" TO "AvailabilitySubmission_pkey";

-- RenameIndex
ALTER INDEX "EmployeeAvailability_status_idx" RENAME TO "AvailabilitySubmission_status_idx";

-- CreateIndex (employeeId is now looked up directly — many rows per employee, not a unique key)
CREATE INDEX "AvailabilitySubmission_employeeId_idx" ON "AvailabilitySubmission"("employeeId");
