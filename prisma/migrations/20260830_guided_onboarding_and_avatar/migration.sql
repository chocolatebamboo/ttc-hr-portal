-- CreateEnum
CREATE TYPE "OnboardingItemType" AS ENUM ('TASK', 'DOCUMENT', 'TRAINING', 'MEETING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OnboardingItemStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "OnboardingItemStatus" ADD VALUE 'RETURNED';

-- DropForeignKey
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_authorId_fkey";

-- DropForeignKey
ALTER TABLE "AnnouncementAudience" DROP CONSTRAINT "AnnouncementAudience_announcementId_fkey";

-- DropForeignKey
ALTER TABLE "AnnouncementAudience" DROP CONSTRAINT "AnnouncementAudience_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "AnnouncementAudience" DROP CONSTRAINT "AnnouncementAudience_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentAcknowledgment" DROP CONSTRAINT "DocumentAcknowledgment_documentId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentAcknowledgment" DROP CONSTRAINT "DocumentAcknowledgment_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentAssignment" DROP CONSTRAINT "DocumentAssignment_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentAssignment" DROP CONSTRAINT "DocumentAssignment_documentId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentAssignment" DROP CONSTRAINT "DocumentAssignment_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_supervisorId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeOnboarding" DROP CONSTRAINT "EmployeeOnboarding_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "OnboardingItem" DROP CONSTRAINT "OnboardingItem_onboardingId_fkey";

-- DropForeignKey
ALTER TABLE "PtoRequest" DROP CONSTRAINT "PtoRequest_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "PtoRequest" DROP CONSTRAINT "PtoRequest_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "TimeEntry" DROP CONSTRAINT "TimeEntry_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "TimeEntryAuditEvent" DROP CONSTRAINT "TimeEntryAuditEvent_actorId_fkey";

-- DropForeignKey
ALTER TABLE "TimeEntryAuditEvent" DROP CONSTRAINT "TimeEntryAuditEvent_timeEntryId_fkey";

-- AlterTable
ALTER TABLE "Announcement" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AnnouncementAudience" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DocumentAcknowledgment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DocumentAssignment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "avatarStorageKey" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EmployeeOnboarding" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OnboardingItem" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "itemType" "OnboardingItemType" NOT NULL DEFAULT 'TASK',
ADD COLUMN     "returnReason" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PtoRequest" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TimeEntry" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TimeEntryAuditEvent" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "OnboardingItem_documentId_idx" ON "OnboardingItem"("documentId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntryAuditEvent" ADD CONSTRAINT "TimeEntryAuditEvent_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntryAuditEvent" ADD CONSTRAINT "TimeEntryAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtoRequest" ADD CONSTRAINT "PtoRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtoRequest" ADD CONSTRAINT "PtoRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAssignment" ADD CONSTRAINT "DocumentAssignment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAssignment" ADD CONSTRAINT "DocumentAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAssignment" ADD CONSTRAINT "DocumentAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAcknowledgment" ADD CONSTRAINT "DocumentAcknowledgment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAcknowledgment" ADD CONSTRAINT "DocumentAcknowledgment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboarding" ADD CONSTRAINT "EmployeeOnboarding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "EmployeeOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

