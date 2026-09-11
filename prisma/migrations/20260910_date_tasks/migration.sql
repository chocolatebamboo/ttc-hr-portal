CREATE TYPE "DateTaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'APPROVED');

CREATE TABLE "DateTask" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "taskDate" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DateTaskStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DateTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DateTask_employeeId_taskDate_idx" ON "DateTask"("employeeId", "taskDate");
CREATE INDEX "DateTask_employeeId_status_idx" ON "DateTask"("employeeId", "status");

ALTER TABLE "DateTask" ADD CONSTRAINT "DateTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DateTask" ADD CONSTRAINT "DateTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DateTask" ADD CONSTRAINT "DateTask_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
