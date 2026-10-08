-- CB, Oct 2026: "I should be able to review what was submitted for the task" — until now,
-- submitDateTask (src/lib/date-tasks.ts) took no content at all; tapping the complete circle was
-- a pure status flip, so a reviewer had nothing to look at beyond the task's own original
-- title/description (set at ASSIGNMENT, not at completion) and the separate, optional comment
-- thread. These three columns let the employee leave a short note and an optional photo/file
-- AT THE MOMENT they submit, same "note + optional one file" shape DateTask's own attachmentKey/
-- attachmentName pair already uses for the original assignment, and DateTaskComment's
-- attachmentKey/attachmentName pair uses for a reply — nullable, since both stay fully optional
-- (a bare tap with nothing typed still submits, exactly as before).
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`).
--
-- No RLS change needed: date_task_write (prisma/rls.sql) is row-level only ("is this employeeId's
-- row, or one you supervise/administer"), not a column allow-list, so these new columns pass
-- through the existing policy untouched — same reasoning as returnNote's own original migration.
ALTER TABLE "DateTask" ADD COLUMN "submissionNote" TEXT;
ALTER TABLE "DateTask" ADD COLUMN "submissionAttachmentKey" TEXT;
ALTER TABLE "DateTask" ADD COLUMN "submissionAttachmentName" TEXT;
