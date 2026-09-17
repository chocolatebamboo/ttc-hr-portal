-- Correction brief (Sept 2026, "Correction & Refinement Brief" #1/#9): real server-side
-- read/unread tracking for TeamNote/DirectMessage, and a real persisted-dismissal record for
-- the two DashboardNotifications.tsx banners (replacing localStorage). See these models' own
-- doc comments in prisma/schema.prisma for the full reasoning.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`).

CREATE TABLE "MessageReadState" (
  "id"         TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "threadKey"  TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MessageReadState_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MessageReadState"
  ADD CONSTRAINT "MessageReadState_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "MessageReadState_employeeId_threadKey_key" ON "MessageReadState"("employeeId", "threadKey");
CREATE INDEX "MessageReadState_employeeId_idx" ON "MessageReadState"("employeeId");

CREATE TABLE "DashboardDismissal" (
  "id"          TEXT NOT NULL,
  "employeeId"  TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DashboardDismissal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DashboardDismissal"
  ADD CONSTRAINT "DashboardDismissal_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "DashboardDismissal_employeeId_key_key" ON "DashboardDismissal"("employeeId", "key");

-- RLS: both tables are purely private per-employee state — every row an employee can see, they
-- also own, and every write they make is only ever for themselves (unlike Notification, which
-- the app writes FOR someone else and so needs an insert_with_check(true) escape hatch — see
-- notification_insert's own comment in this file). select/insert/update all key off the exact
-- same predicate, no admin override, no exceptions.
alter table "MessageReadState" enable row level security;
alter table "MessageReadState" force row level security;

drop policy if exists message_read_state_select on "MessageReadState";
create policy message_read_state_select on "MessageReadState" for select using (
  "employeeId" = current_employee_id()
);

drop policy if exists message_read_state_insert on "MessageReadState";
create policy message_read_state_insert on "MessageReadState" for insert with check (
  "employeeId" = current_employee_id()
);

drop policy if exists message_read_state_update on "MessageReadState";
create policy message_read_state_update on "MessageReadState" for update using (
  "employeeId" = current_employee_id()
) with check (
  "employeeId" = current_employee_id()
);

alter table "DashboardDismissal" enable row level security;
alter table "DashboardDismissal" force row level security;

drop policy if exists dashboard_dismissal_select on "DashboardDismissal";
create policy dashboard_dismissal_select on "DashboardDismissal" for select using (
  "employeeId" = current_employee_id()
);

drop policy if exists dashboard_dismissal_insert on "DashboardDismissal";
create policy dashboard_dismissal_insert on "DashboardDismissal" for insert with check (
  "employeeId" = current_employee_id()
);

drop policy if exists dashboard_dismissal_update on "DashboardDismissal";
create policy dashboard_dismissal_update on "DashboardDismissal" for update using (
  "employeeId" = current_employee_id()
) with check (
  "employeeId" = current_employee_id()
);
