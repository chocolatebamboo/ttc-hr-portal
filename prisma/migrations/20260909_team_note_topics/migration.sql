-- Scopes a TeamNote to a specific thing about the employee (a single selected availability
-- date, or a single PTO request) instead of always the one big general thread. All three
-- columns stay null on every note posted before this migration, which is exactly the existing
-- general-thread behavior — nothing already posted changes meaning.
ALTER TABLE "TeamNote" ADD COLUMN "topicType" TEXT;
ALTER TABLE "TeamNote" ADD COLUMN "topicId" TEXT;
ALTER TABLE "TeamNote" ADD COLUMN "topicDate" TEXT;

CREATE INDEX "TeamNote_employeeId_topicType_topicId_topicDate_createdAt_idx"
  ON "TeamNote"("employeeId", "topicType", "topicId", "topicDate", "createdAt");
