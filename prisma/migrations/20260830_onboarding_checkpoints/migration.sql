-- CreateEnum
CREATE TYPE "OnboardingCheckpointStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
-- Lightweight 30/60/90-day onboarding follow-ups — see OnboardingCheckpoint's doc comment in
-- prisma/schema.prisma. Never exposed to the employee (see prisma/rls.sql for this table).
CREATE TABLE "OnboardingCheckpoint" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "OnboardingCheckpointStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "followUpNeeded" BOOLEAN NOT NULL DEFAULT false,
    "trainingMilestones" TEXT,
    "developmentGoals" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnboardingCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingCheckpoint_employeeId_idx" ON "OnboardingCheckpoint"("employeeId");

-- AddForeignKey
ALTER TABLE "OnboardingCheckpoint" ADD CONSTRAINT "OnboardingCheckpoint_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
