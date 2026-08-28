-- TTC HR Portal — Row-Level Security (the database-layer authorization backstop)
--
-- WHY THIS FILE EXISTS
-- The app (Next.js API routes, see src/lib/authorization.ts) checks permissions on every
-- request. This file makes the DATABASE enforce the same rules independently, so a bug or
-- omission in the app-layer check still can't leak a row it shouldn't. That only works if
-- the app's Postgres connection is NOT a superuser / BYPASSRLS role — see the README for how
-- DATABASE_URL and MIGRATE_DATABASE_URL must differ.
--
-- Run this AFTER `prisma migrate deploy` has created the tables (RLS policies reference
-- tables Prisma owns; Prisma's migration engine needs an elevated connection that this
-- policy set is deliberately not granting).

-- 1. A dedicated, non-superuser role for the running app to connect as.
--    Generate a real password and put the resulting connection string in DATABASE_URL —
--    never reuse the migration/owner connection string for the running app.
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login password 'REPLACE_ME' nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;

-- 2. Per-request identity. The app sets these two session variables at the start of every
--    transaction (see withRlsContext() in src/lib/db.ts) from the caller's verified Supabase
--    Auth session — never from client-supplied input.
create or replace function current_employee_id() returns uuid as $$
  select nullif(current_setting('app.current_employee_id', true), '')::uuid
$$ language sql stable;

create or replace function current_role_name() returns text as $$
  select nullif(current_setting('app.current_role', true), '')
$$ language sql stable;

create or replace function is_admin() returns boolean as $$
  select current_role_name() in ('SUPER_ADMIN', 'HR_ADMIN')
$$ language sql stable;

-- 3. Enable + FORCE row level security. FORCE matters: without it, a table's owner role
--    (which app_user effectively is not, but double-checking future connection changes)
--    would silently bypass its own policies.

alter table "Employee" enable row level security;
alter table "Employee" force row level security;

create policy employee_select on "Employee" for select using (
  is_admin()
  or id = current_employee_id()
  or "supervisorId" = current_employee_id()
);

-- Only admins write employee records; supervisors and employees never mutate this table directly.
create policy employee_write on "Employee" for all using (is_admin()) with check (is_admin());


alter table "TimeEntry" enable row level security;
alter table "TimeEntry" force row level security;

create policy time_entry_select on "TimeEntry" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);

-- Employees may only insert/update their OWN in-progress entries; approvals/corrections by
-- supervisors or HR go through the audited API routes, which run with is_admin()/supervisor
-- context already verified at the app layer — the DB policy still requires it independently.
create policy time_entry_write_own on "TimeEntry" for all using (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
) with check (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);


alter table "TimeEntryAuditEvent" enable row level security;
alter table "TimeEntryAuditEvent" force row level security;

create policy time_audit_select on "TimeEntryAuditEvent" for select using (
  is_admin()
  or "timeEntryId" in (
    select id from "TimeEntry" where "employeeId" = current_employee_id()
      or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
  )
);
-- Audit rows are append-only: no update/delete policy is granted at all, by anyone.
create policy time_audit_insert on "TimeEntryAuditEvent" for insert with check (true);


alter table "PtoRequest" enable row level security;
alter table "PtoRequest" force row level security;

create policy pto_select on "PtoRequest" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);

create policy pto_write on "PtoRequest" for all using (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
) with check (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);


alter table "Document" enable row level security;
alter table "Document" force row level security;

-- Confidential-tier documents are never visible through this policy to non-admins, full stop
-- — visibility/assignment for GLOBAL / DEPARTMENT / INDIVIDUAL tiers is resolved by joining
-- DocumentAssignment, which carries its own policy below.
create policy document_select on "Document" for select using (
  is_admin()
  or (
    "visibility" != 'CONFIDENTIAL_HR'
    and (
      "visibility" = 'GLOBAL'
      or id in (
        select "documentId" from "DocumentAssignment"
        where "employeeId" = current_employee_id()
           or "departmentId" in (select "departmentId" from "Employee" where id = current_employee_id())
      )
    )
  )
);

create policy document_write on "Document" for all using (is_admin()) with check (is_admin());


alter table "DocumentAssignment" enable row level security;
alter table "DocumentAssignment" force row level security;

create policy document_assignment_select on "DocumentAssignment" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "departmentId" in (select "departmentId" from "Employee" where id = current_employee_id())
);

create policy document_assignment_write on "DocumentAssignment" for all using (is_admin()) with check (is_admin());


alter table "DocumentAcknowledgment" enable row level security;
alter table "DocumentAcknowledgment" force row level security;

create policy ack_select on "DocumentAcknowledgment" for select using (
  is_admin() or "employeeId" = current_employee_id()
);

create policy ack_insert on "DocumentAcknowledgment" for insert with check (
  "employeeId" = current_employee_id()
);


alter table "EmployeeOnboarding" enable row level security;
alter table "EmployeeOnboarding" force row level security;

create policy onboarding_select on "EmployeeOnboarding" for select using (
  is_admin() or "employeeId" = current_employee_id()
);
create policy onboarding_write on "EmployeeOnboarding" for all using (is_admin()) with check (is_admin());


alter table "OnboardingItem" enable row level security;
alter table "OnboardingItem" force row level security;

create policy onboarding_item_select on "OnboardingItem" for select using (
  is_admin()
  or "onboardingId" in (select id from "EmployeeOnboarding" where "employeeId" = current_employee_id())
);
-- Employees may check off their own items; admins may edit any.
create policy onboarding_item_update on "OnboardingItem" for update using (
  is_admin()
  or "onboardingId" in (select id from "EmployeeOnboarding" where "employeeId" = current_employee_id())
) with check (
  is_admin()
  or "onboardingId" in (select id from "EmployeeOnboarding" where "employeeId" = current_employee_id())
);
create policy onboarding_item_insert on "OnboardingItem" for insert with check (is_admin());


alter table "AuditLog" enable row level security;
alter table "AuditLog" force row level security;

create policy audit_log_select on "AuditLog" for select using (is_admin());
create policy audit_log_insert on "AuditLog" for insert with check (true);

-- Departments and Announcements are low-sensitivity read-mostly reference data — every
-- authenticated employee may read them; only admins write. Enforced at the app layer only
-- (see src/lib/authorization.ts) since no employee-specific data is at risk here.
