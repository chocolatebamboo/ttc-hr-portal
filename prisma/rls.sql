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

-- 1b. Defense in depth, independent of every policy below. Supabase grants `anon` and
--     `authenticated` (the roles its own PostgREST API and client libraries connect as)
--     broad default privileges on every new public-schema table — reasonable for a project
--     that talks to Postgres that way, wrong for this one, which never does: the running app
--     connects exclusively as app_user via Prisma (src/lib/db.ts) and never uses the Supabase
--     client/PostgREST for data access. Left alone, anon/authenticated having any grant here
--     means a single future RLS policy mistake (see the search_path correction below — that
--     exact kind of mistake happened once already, caught only because it was tested against
--     a real database) would turn directly into a full data exposure through the public anon
--     key, not just an app-level error. Revoking removes that dependency on RLS alone; it has
--     zero functional cost since the app never authenticates as either role.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- 2. Per-request identity. The app sets these two session variables at the start of every
--    transaction (see withRlsContext() in src/lib/db.ts) from the caller's verified Supabase
--    Auth session — never from client-supplied input.
-- Returns text, not uuid — deliberately. Prisma's default column-type mapping for a
-- `String @id @default(uuid())` field on PostgreSQL is `text` (there's no `@db.Uuid`
-- anywhere in schema.prisma), so every id/employeeId/supervisorId/etc. column this gets
-- compared against IS text. An earlier version of this function returned `uuid` (casting
-- the session variable with `::uuid`), which looked reasonable but is wrong: Postgres has
-- no `text = uuid` operator, so every single policy using it would fail at query time with
-- "operator does not exist: text = uuid" — not a permissions bug, a hard error on every
-- request. Caught by testing against a real Postgres instance for the first time (roadmap
-- step 12); every verification before that was against JS mocks, which can't catch a
-- database-level operator resolution error because they never ask real Postgres to resolve
-- one. Worth remembering if a future column genuinely is native `uuid` (`@db.Uuid`) instead
-- of `text` — this function would need to change back for that column, deliberately, not by
-- copy-paste.
create or replace function current_employee_id() returns text as $$
  select nullif(current_setting('app.current_employee_id', true), '')
$$ language sql stable;

create or replace function current_role_name() returns text as $$
  select nullif(current_setting('app.current_role', true), '')
$$ language sql stable;

create or replace function is_admin() returns boolean as $$
  select current_role_name() in ('SUPER_ADMIN', 'HR_ADMIN')
$$ language sql stable;

-- The one identity available BEFORE current_employee_id() can be set: the verified Supabase
-- Auth user id, set by withUserIdContext() (src/lib/db.ts) for exactly one query — the very
-- first lookup of a session into an Employee row, which is how the app discovers employeeId
-- in the first place. Everything after that uses current_employee_id()/current_role_name()
-- like normal. See the note on employee_select below for why this function has to exist at
-- all — without it, that first lookup is a real chicken-and-egg problem, not a formality.
create or replace function current_auth_user_id() returns text as $$
  select nullif(current_setting('app.current_user_id', true), '')
$$ language sql stable;

-- Supabase's security advisor flags a function with no explicit search_path as a WARN: a
-- caller able to create objects earlier in the resolution order could in principle shadow an
-- unqualified name a function relies on. None of the four functions above reference any
-- table (only current_setting()/nullif(), both pg_catalog builtins search_path can't affect),
-- so practical exploitability here is low — but they run inside every RLS policy in this app,
-- so it costs nothing to close anyway. `search_path = 'public'`, not `''`: these functions
-- call each other by their unqualified public-schema names (is_admin() calls
-- current_role_name()), and an EMPTY search_path breaks that resolution entirely — every
-- policy in this file would fail on every request. That exact mistake happened once while
-- setting this project up and was caught immediately by testing live, not assumed safe from
-- the advisor's clean re-scan alone. ALTER FUNCTION is idempotent (each run just re-sets the
-- same value) and independent of the CREATE OR REPLACE bodies above, so it has to be re-run
-- here explicitly — replacing a function body does not preserve or reset this setting.
alter function current_employee_id() set search_path = 'public';
alter function current_role_name() set search_path = 'public';
alter function is_admin() set search_path = 'public';
alter function current_auth_user_id() set search_path = 'public';

-- 3. Enable + FORCE row level security. FORCE matters: without it, a table's owner role
--    (which app_user effectively is not, but double-checking future connection changes)
--    would silently bypass its own policies.

alter table "Employee" enable row level security;
alter table "Employee" force row level security;

-- employee_select governs ROW visibility only, not which columns come back — every active
-- employee is a visible row to every other authenticated employee (the Directory needs this:
-- there is no such thing as a company directory that only shows your own manager chain). What
-- keeps personalPhone, personalEmail, emergencyContact*, employeeCode, hireDate, etc. private
-- is that src/lib/directory.ts's own Prisma `select` never asks the database for those columns
-- in the first place — the same "RLS = rows, app SELECT = columns" split this app already uses
-- for Document/Onboarding admin-vs-employee DTOs. A deactivated employee (still visible to
-- admins/their own supervisor chain for records purposes) is excluded from this broader grant.
--
-- The directory clause is deliberately `current_employee_id() is not null and ... ` rather than
-- just `"deactivatedAt" is null` on its own. Without the identity check, this clause has no
-- dependency on WHO is asking at all — it would make every active employee's row readable by
-- ANY query running as app_user, including one that (by a future bug) forgot to call
-- withRlsContext()/withUserIdContext() first. That used to fail closed (no session vars set →
-- every clause false → zero rows) before Directory needed a broad grant; this keeps that
-- fail-closed behavior for everything except a genuinely-authenticated request.
--
-- The userId clause exists for exactly one caller: getCurrentEmployee() (src/lib/auth.ts),
-- resolving a Supabase session into an Employee row for the first time in a request — before
-- that succeeds, current_employee_id() CAN'T be set yet, because the app doesn't know the
-- employeeId to set it to. current_auth_user_id() is the one piece of identity available at
-- that point (the verified Supabase Auth user id), via withUserIdContext().
drop policy if exists employee_select on "Employee";
create policy employee_select on "Employee" for select using (
  is_admin()
  or id = current_employee_id()
  or "supervisorId" = current_employee_id()
  or "userId" = current_auth_user_id()
  or (current_employee_id() is not null and "deactivatedAt" is null)
);

-- Only admins write employee records; supervisors and employees never mutate this table directly.
drop policy if exists employee_write on "Employee";
create policy employee_write on "Employee" for all using (is_admin()) with check (is_admin());


alter table "TimeEntry" enable row level security;
alter table "TimeEntry" force row level security;

drop policy if exists time_entry_select on "TimeEntry";
create policy time_entry_select on "TimeEntry" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);

-- Employees may only insert/update their OWN in-progress entries; approvals/corrections by
-- supervisors or HR go through the audited API routes, which run with is_admin()/supervisor
-- context already verified at the app layer — the DB policy still requires it independently.
drop policy if exists time_entry_write_own on "TimeEntry";
create policy time_entry_write_own on "TimeEntry" for all using (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
) with check (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);


alter table "TimeEntryAuditEvent" enable row level security;
alter table "TimeEntryAuditEvent" force row level security;

drop policy if exists time_audit_select on "TimeEntryAuditEvent";
create policy time_audit_select on "TimeEntryAuditEvent" for select using (
  is_admin()
  or "timeEntryId" in (
    select id from "TimeEntry" where "employeeId" = current_employee_id()
      or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
  )
);
-- Audit rows are append-only: no update/delete policy is granted at all, by anyone.
drop policy if exists time_audit_insert on "TimeEntryAuditEvent";
create policy time_audit_insert on "TimeEntryAuditEvent" for insert with check (true);


alter table "PtoRequest" enable row level security;
alter table "PtoRequest" force row level security;

drop policy if exists pto_select on "PtoRequest";
create policy pto_select on "PtoRequest" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);

drop policy if exists pto_write on "PtoRequest";
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
drop policy if exists document_select on "Document";
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

drop policy if exists document_write on "Document";
create policy document_write on "Document" for all using (is_admin()) with check (is_admin());


alter table "DocumentAssignment" enable row level security;
alter table "DocumentAssignment" force row level security;

drop policy if exists document_assignment_select on "DocumentAssignment";
create policy document_assignment_select on "DocumentAssignment" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "departmentId" in (select "departmentId" from "Employee" where id = current_employee_id())
);

drop policy if exists document_assignment_write on "DocumentAssignment";
create policy document_assignment_write on "DocumentAssignment" for all using (is_admin()) with check (is_admin());


alter table "DocumentAcknowledgment" enable row level security;
alter table "DocumentAcknowledgment" force row level security;

drop policy if exists ack_select on "DocumentAcknowledgment";
create policy ack_select on "DocumentAcknowledgment" for select using (
  is_admin() or "employeeId" = current_employee_id()
);

drop policy if exists ack_insert on "DocumentAcknowledgment";
create policy ack_insert on "DocumentAcknowledgment" for insert with check (
  "employeeId" = current_employee_id()
);


alter table "EmployeeOnboarding" enable row level security;
alter table "EmployeeOnboarding" force row level security;

-- Guided onboarding (Aug 2026) added a real approval step: a supervisor now needs to be able
-- to see AND act on their own direct reports' onboarding, not just HR/admins — the same
-- "admin, or the row's own owner, or that owner's supervisor" three-way shape TimeEntry/
-- PtoRequest already use above, just applied to onboarding for the first time here.
drop policy if exists onboarding_select on "EmployeeOnboarding";
create policy onboarding_select on "EmployeeOnboarding" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);
-- Split into insert vs. update (rather than one "for all") because they need genuinely
-- different rules, and a single with-check clause on "for all" would apply to both no matter
-- what: starting a brand-new checklist stays admin-only, but approving a step is what flips
-- EmployeeOnboarding.completedAt (recomputeOnboardingCompletion in src/lib/onboarding.ts), and
-- a supervisor approving their own report's last step needs to be able to make THAT write —
-- without a separate update policy, an approval by a supervisor (as opposed to an admin) would
-- succeed on the OnboardingItem row but then silently fail to ever mark the checklist itself
-- complete.
drop policy if exists onboarding_write on "EmployeeOnboarding";
drop policy if exists onboarding_insert on "EmployeeOnboarding";
create policy onboarding_insert on "EmployeeOnboarding" for insert with check (is_admin());
-- NOTE: this used to be is_admin()-only (pre-dating the supervisor-approval feature this
-- policy split was written for) — which meant an EMPLOYEE finishing their own last checklist
-- item could never actually flip EmployeeOnboarding.completedAt at all: recomputeOnboardingCompletion
-- (src/lib/onboarding.ts), running under that employee's own identity, would have hit this
-- policy and failed. Self-completion is included here now, alongside admin and supervisor-of,
-- to close that gap as well as add the new supervisor case.
drop policy if exists onboarding_update on "EmployeeOnboarding";
create policy onboarding_update on "EmployeeOnboarding" for update using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
) with check (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);


alter table "OnboardingItem" enable row level security;
alter table "OnboardingItem" force row level security;

drop policy if exists onboarding_item_select on "OnboardingItem";
create policy onboarding_item_select on "OnboardingItem" for select using (
  is_admin()
  or "onboardingId" in (select id from "EmployeeOnboarding" where "employeeId" = current_employee_id())
  or "onboardingId" in (
    select eo.id from "EmployeeOnboarding" eo
    join "Employee" e on e.id = eo."employeeId"
    where e."supervisorId" = current_employee_id()
  )
);
-- Employees may submit/toggle their own items; a supervisor may approve/return their own
-- direct reports' items; admins may edit any. Which of those three a given request actually
-- IS (a plain self-toggle vs. an approval-only action) is enforced at the app layer
-- (assertCanReviewOnboarding in src/lib/authorization.ts) before this policy is ever reached —
-- this is still the independent second check, not the only one.
drop policy if exists onboarding_item_update on "OnboardingItem";
create policy onboarding_item_update on "OnboardingItem" for update using (
  is_admin()
  or "onboardingId" in (select id from "EmployeeOnboarding" where "employeeId" = current_employee_id())
  or "onboardingId" in (
    select eo.id from "EmployeeOnboarding" eo
    join "Employee" e on e.id = eo."employeeId"
    where e."supervisorId" = current_employee_id()
  )
) with check (
  is_admin()
  or "onboardingId" in (select id from "EmployeeOnboarding" where "employeeId" = current_employee_id())
  or "onboardingId" in (
    select eo.id from "EmployeeOnboarding" eo
    join "Employee" e on e.id = eo."employeeId"
    where e."supervisorId" = current_employee_id()
  )
);
drop policy if exists onboarding_item_insert on "OnboardingItem";
create policy onboarding_item_insert on "OnboardingItem" for insert with check (is_admin());


alter table "AuditLog" enable row level security;
alter table "AuditLog" force row level security;

drop policy if exists audit_log_select on "AuditLog";
create policy audit_log_select on "AuditLog" for select using (is_admin());
drop policy if exists audit_log_insert on "AuditLog";
create policy audit_log_insert on "AuditLog" for insert with check (true);

-- Department / Announcement / AnnouncementAudience: low-sensitivity, read-mostly reference
-- data — every authenticated employee may read them, only admins write. This USED to be
-- "enforced at the app layer only" (see src/lib/authorization.ts), on the reasoning that
-- there's no employee-specific data at risk here. That reasoning had a real hole: Supabase
-- auto-exposes every public-schema table over its own PostgREST API to the `anon` and
-- `authenticated` Postgres roles, independent of whether this app's own code ever calls that
-- API — so "the app is the only path to this data" was never actually true once the project
-- went live, and Supabase's own security advisor flagged exactly that (RLS disabled, "fully
-- exposed to anon/authenticated") the moment these tables existed for real. Fixed the same
-- way as everything else in this file — this doesn't replicate Announcement's audience-window
-- filtering logic (publishDate/expirationDate/department/individual targeting), which stays a
-- UX concern the app owns; it just stops a stranger holding the public anon key from reading
-- or forging company announcements or department records directly.

alter table "Department" enable row level security;
alter table "Department" force row level security;

drop policy if exists department_select on "Department";
create policy department_select on "Department" for select using (
  is_admin() or current_employee_id() is not null
);
drop policy if exists department_write on "Department";
create policy department_write on "Department" for all using (is_admin()) with check (is_admin());


alter table "Announcement" enable row level security;
alter table "Announcement" force row level security;

drop policy if exists announcement_select on "Announcement";
create policy announcement_select on "Announcement" for select using (
  is_admin() or current_employee_id() is not null
);
drop policy if exists announcement_write on "Announcement";
create policy announcement_write on "Announcement" for all using (is_admin()) with check (is_admin());


alter table "AnnouncementAudience" enable row level security;
alter table "AnnouncementAudience" force row level security;

drop policy if exists announcement_audience_select on "AnnouncementAudience";
create policy announcement_audience_select on "AnnouncementAudience" for select using (
  is_admin() or current_employee_id() is not null
);
drop policy if exists announcement_audience_write on "AnnouncementAudience";
create policy announcement_audience_write on "AnnouncementAudience" for all using (is_admin()) with check (is_admin());
