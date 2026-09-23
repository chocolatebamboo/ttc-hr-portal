-- Phase 5c (CB, Sept 2026): "hovering over a message should show quick emoji reactions and an
-- option to add an internal comment," confirmed scope "hidden from the team member." One flat,
-- delete-less comment table per DirectMessage, same shape DateTaskComment already uses for a
-- task's own comment thread — but gated by role, not just participation, in its RLS below.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (this project's Render build never runs `prisma migrate
-- deploy`, only `prisma generate`).

CREATE TABLE "DirectMessageComment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DirectMessageComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DirectMessageComment_messageId_createdAt_idx" ON "DirectMessageComment"("messageId", "createdAt");

ALTER TABLE "DirectMessageComment"
  ADD CONSTRAINT "DirectMessageComment_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "DirectMessage"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "DirectMessageComment"
  ADD CONSTRAINT "DirectMessageComment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "Employee"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- RLS: gated by role (SUPER_ADMIN/HR_ADMIN/SUPERVISOR — "not a plain team member") ON TOP OF
-- the usual "am I a participant in this DM" check, not participation alone. See
-- prisma/rls.sql's own direct_message_comment_select/_insert for the full definitions and their
-- own comments — reproduced here only so this migration is a complete, standalone record of
-- what was applied.
ALTER TABLE "DirectMessageComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DirectMessageComment" FORCE ROW LEVEL SECURITY;

CREATE POLICY direct_message_comment_select ON "DirectMessageComment" FOR SELECT USING (
  current_role_name() <> 'EMPLOYEE'
  AND EXISTS (
    SELECT 1 FROM "DirectMessage" dm
    WHERE dm.id = "DirectMessageComment"."messageId"
      AND (dm."senderId" = current_employee_id() OR dm."recipientId" = current_employee_id())
  )
);

CREATE POLICY direct_message_comment_insert ON "DirectMessageComment" FOR INSERT WITH CHECK (
  current_role_name() <> 'EMPLOYEE'
  AND "authorId" = current_employee_id()
  AND EXISTS (
    SELECT 1 FROM "DirectMessage" dm
    WHERE dm.id = "DirectMessageComment"."messageId"
      AND (dm."senderId" = current_employee_id() OR dm."recipientId" = current_employee_id())
  )
);
