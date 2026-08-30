-- CreateTable
-- Internal admin/supervisor-only readiness tasks — see OnboardingReadinessItem's doc comment in
-- prisma/schema.prisma. Never exposed to the employee (see prisma/rls.sql for this table).
CREATE TABLE "OnboardingReadinessItem" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnboardingReadinessItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingReadinessItem_employeeId_idx" ON "OnboardingReadinessItem"("employeeId");

-- AddForeignKey
ALTER TABLE "OnboardingReadinessItem" ADD CONSTRAINT "OnboardingReadinessItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
