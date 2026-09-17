-- Correction brief (Sept 2026, "Correction & Refinement Brief" #2): redesign DateTask into a
-- real per-task workflow — title + instructions, a 5-state lifecycle (ASSIGNED/IN_PROGRESS/
-- AWAITING_REVIEW/APPROVED/RETURNED), return-with-a-note, and a task-scoped DateTaskComment
-- table replacing the standalone per-date TeamNote "Conversation" section. See DateTask/
-- DateTaskComment's own doc comments in prisma/schema.prisma for the full reasoning.
--
-- Informational only — already applied directly to the live Supabase database via
-- mcp__Supabase__apply_migration (same reasoning as every prior phase's migration files: this
-- project's Render build never runs `prisma migrate deploy`, only `prisma generate`). At the
-- time this ran, "DateTask" had exactly 2 rows, both PENDING — the backfill below is written
-- generally regardless.

-- 1. New columns
alter table "DateTask" add column "title" text;
alter table "DateTask" add column "startedAt" timestamp(3);
alter table "DateTask" add column "returnedById" text;
alter table "DateTask" add column "returnedAt" timestamp(3);
alter table "DateTask" add column "returnNote" text;

-- 2. Backfill title from the existing description (best available source pre-rework)
update "DateTask" set "title" =
  case when length("description") > 60 then left("description", 57) || '...' else "description" end
where "title" is null;

alter table "DateTask" alter column "title" set not null;

-- 3. Swap the status enum: new type with the target 5 values, backfill-mapped from the old 3,
--    then drop the old type entirely rather than leaving unused legacy values around forever.
create type "DateTaskStatus_new" as enum ('ASSIGNED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'APPROVED', 'RETURNED');

alter table "DateTask" add column "status_new" "DateTaskStatus_new";

update "DateTask" set "status_new" = case "status"::text
  when 'PENDING' then 'ASSIGNED'
  when 'COMPLETED' then 'AWAITING_REVIEW'
  when 'APPROVED' then 'APPROVED'
  else 'ASSIGNED'
end::"DateTaskStatus_new";

alter table "DateTask" drop column "status";
alter table "DateTask" rename column "status_new" to "status";
alter table "DateTask" alter column "status" set default 'ASSIGNED';
alter table "DateTask" alter column "status" set not null;

drop type "DateTaskStatus";
alter type "DateTaskStatus_new" rename to "DateTaskStatus";

-- 4. completedAt -> submittedAt (same column, same meaning under the new state names)
alter table "DateTask" rename column "completedAt" to "submittedAt";

-- 5. FK for the new returnedById
alter table "DateTask" add constraint "DateTask_returnedById_fkey"
  foreign key ("returnedById") references "Employee"(id);

-- 6. New DateTaskComment table
create table "DateTaskComment" (
  "id"             text not null,
  "taskId"         text not null,
  "authorId"       text not null,
  "body"           text not null,
  "attachmentKey"  text,
  "attachmentName" text,
  "createdAt"      timestamp(3) not null default current_timestamp,

  constraint "DateTaskComment_pkey" primary key ("id")
);

alter table "DateTaskComment"
  add constraint "DateTaskComment_taskId_fkey"
  foreign key ("taskId") references "DateTask"("id") on update cascade on delete cascade;

alter table "DateTaskComment"
  add constraint "DateTaskComment_authorId_fkey"
  foreign key ("authorId") references "Employee"("id") on update cascade on delete restrict;

create index "DateTaskComment_taskId_createdAt_idx" on "DateTaskComment"("taskId", "createdAt");

-- 7. NotificationType: two new values, additive (existing rows untouched)
alter type "NotificationType" add value if not exists 'DATE_TASK_APPROVED';
alter type "NotificationType" add value if not exists 'DATE_TASK_RETURNED';

-- 8. RLS for the new table (DateTask's own policies are unchanged — same self/supervisor/admin
--    shape as before, just against the reworked column set). See prisma/rls.sql for the
--    canonical, idempotent copy of these two policies.
alter table "DateTaskComment" enable row level security;
alter table "DateTaskComment" force row level security;

create policy date_task_comment_select on "DateTaskComment" for select using (
  "taskId" in (
    select id from "DateTask"
    where "employeeId" = current_employee_id() or is_admin()
       or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
  )
);

create policy date_task_comment_insert on "DateTaskComment" for insert with check (
  "authorId" = current_employee_id()
  and "taskId" in (
    select id from "DateTask"
    where "employeeId" = current_employee_id() or is_admin()
       or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
  )
);
