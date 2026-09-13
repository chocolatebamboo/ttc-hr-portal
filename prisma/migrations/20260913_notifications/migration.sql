-- Phase 4 (client spec, Sept 2026): "a real in-app notification feed." See Notification's own
-- doc comment in prisma/schema.prisma for why this is a separate table from the existing
-- AuditLog rather than a widened version of it.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`).
CREATE TYPE "NotificationType" AS ENUM (
  'SHIFT_CREATED',
  'SHIFT_CANCELLED',
  'SHIFT_REASSIGNED',
  'SHIFT_CHANGE_APPROVED',
  'SHIFT_REQUEST_DECLINED',
  'SHIFT_REQUEST_RECEIVED',
  'AVAILABILITY_APPROVED',
  'AVAILABILITY_DENIED',
  'AVAILABILITY_ADJUSTMENT_PROPOSED',
  'PTO_APPROVED',
  'PTO_DENIED',
  'DATE_TASK_ASSIGNED'
);

CREATE TABLE "Notification" (
  "id"          TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "type"        "NotificationType" NOT NULL,
  "title"       TEXT NOT NULL,
  "body"        TEXT,
  "targetType"  TEXT NOT NULL,
  "targetId"    TEXT NOT NULL,
  "readAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "Employee"(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification"("recipientId", "createdAt");
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");
