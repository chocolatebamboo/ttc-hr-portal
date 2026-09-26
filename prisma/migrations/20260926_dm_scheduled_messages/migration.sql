-- CB, Sept 2026: "Schedule message" — compose a DM now, pick a future date/time, and it goes
-- out on its own then. Two new nullable columns on DirectMessage:
--   scheduledFor: when set, this row is a scheduled draft, not a delivered message yet.
--   sentAt: when the message actually became visible to the recipient. For an ordinary
--     immediate message this is stamped at creation time (same moment as createdAt); for a
--     scheduled one it stays NULL until the dispatch cron (see below) flips it once
--     scheduledFor has passed. Every query that renders a thread/inbox filters on
--     "sentAt is not null" so an unsent scheduled message is invisible to the recipient (and to
--     the sender's own normal thread view — it only shows in the dedicated "Scheduled" list).
--
-- Also finally wires up "chainRootId" — a self-referencing column (with FK + index) that was
-- already sitting on this table, unused by any application code, migration file, or RLS policy
-- (confirmed via information_schema before writing this: 16 existing rows, 0 with it set). It
-- looks like an earlier, never-finished pass at exactly the "flatten a reply chain to its root"
-- mechanism this feature needs for its "View N replies" grouping, so this reuses it rather than
-- adding a redundant column: for a reply, chainRootId always points straight at the ultimate
-- top-level ancestor (never at an intermediate reply), even if replyToId itself ever pointed at
-- a reply instead of a root — see postMessage's own comment in src/lib/direct-messages.ts.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (this project's Render build never runs `prisma migrate
-- deploy`, only `prisma generate`).

ALTER TABLE "DirectMessage" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "DirectMessage" ADD COLUMN "sentAt" TIMESTAMP(3);

-- Backfill: every row that already existed was, by definition, already delivered immediately.
UPDATE "DirectMessage" SET "sentAt" = "createdAt" WHERE "sentAt" IS NULL;

CREATE INDEX "DirectMessage_scheduledFor_idx" ON "DirectMessage"("scheduledFor") WHERE "sentAt" IS NULL;

-- RLS: direct_message_write (FOR ALL) used to cover SELECT too, which would have silently
-- undone the recipient-side restriction below (permissive policies OR together, and the wider
-- one wins). Split it into INSERT/UPDATE/DELETE so direct_message_select is the only policy
-- governing reads. See prisma/rls.sql's own comments for the full reasoning on each of these.
DROP POLICY IF EXISTS direct_message_write ON "DirectMessage";

CREATE POLICY direct_message_insert ON "DirectMessage" FOR INSERT WITH CHECK (
  "senderId" = current_employee_id() OR "recipientId" = current_employee_id()
);

CREATE POLICY direct_message_update ON "DirectMessage" FOR UPDATE USING (
  "senderId" = current_employee_id() OR "recipientId" = current_employee_id()
) WITH CHECK (
  "senderId" = current_employee_id() OR "recipientId" = current_employee_id()
);

CREATE POLICY direct_message_delete ON "DirectMessage" FOR DELETE USING (
  "senderId" = current_employee_id() AND "sentAt" IS NULL
);

DROP POLICY IF EXISTS direct_message_select ON "DirectMessage";
CREATE POLICY direct_message_select ON "DirectMessage" FOR SELECT USING (
  "senderId" = current_employee_id()
  OR ("recipientId" = current_employee_id() AND ("scheduledFor" IS NULL OR "sentAt" IS NOT NULL))
);

CREATE POLICY direct_message_system_dispatch ON "DirectMessage" FOR ALL USING (
  current_role_name() = 'SUPER_ADMIN' AND current_employee_id() = 'system:scheduled-messages'
) WITH CHECK (
  current_role_name() = 'SUPER_ADMIN' AND current_employee_id() = 'system:scheduled-messages'
);
