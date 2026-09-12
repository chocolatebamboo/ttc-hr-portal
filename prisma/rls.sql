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

-- Only admins write employee records; supervisors and employees never mutate this table directly
-- through THIS policy. employee_self_update (below) is a second, narrower path: My Profile
-- (src/app/(portal)/profile) lets an employee edit their own contact info and photo, without
-- opening up the rest of this table the way a blanket "id = current_employee_id()" policy
-- would.
drop policy if exists employee_write on "Employee";
create policy employee_write on "Employee" for all using (is_admin()) with check (is_admin());

-- Employees may update their OWN row (My Profile) — but WITH CHECK only confirms the row is
-- still theirs after the write, not which COLUMNS changed; Postgres RLS is row-level, not
-- column-level. enforce_employee_self_update() below is what actually keeps this from being
-- "employees can edit anything about themselves" — it runs on every UPDATE to this table
-- (admin ones included, where it's a no-op) and rejects a non-admin update outright if it
-- touches anything other than the contact/photo fields My Profile exposes. This is a second
-- PERMISSIVE policy for UPDATE only; Postgres combines multiple permissive policies for the
-- same command with OR, so this adds a self-service path alongside — not instead of —
-- employee_write above (which still covers admin edits to role/title/department/etc.).
create or replace function enforce_employee_self_update() returns trigger as $$
begin
  if is_admin() then
    return new;
  end if;

  if new."id" is distinct from old."id"
    or new."userId" is distinct from old."userId"
    or new."employeeCode" is distinct from old."employeeCode"
    or new."firstName" is distinct from old."firstName"
    or new."lastName" is distinct from old."lastName"
    or new."jobTitle" is distinct from old."jobTitle"
    or new."role" is distinct from old."role"
    or new."employmentStatus" is distinct from old."employmentStatus"
    or new."hireDate" is distinct from old."hireDate"
    or new."departmentId" is distinct from old."departmentId"
    or new."supervisorId" is distinct from old."supervisorId"
    or new."ttcEmail" is distinct from old."ttcEmail"
    or new."deactivatedAt" is distinct from old."deactivatedAt"
    or new."createdAt" is distinct from old."createdAt"
  then
    raise exception 'Employees may only update their own contact info and photo from My Profile — role, title, department, status, and hire date changes go through the Employees admin page.';
  end if;

  return new;
end;
$$ language plpgsql;

alter function enforce_employee_self_update() set search_path = 'public';

drop trigger if exists employee_self_update_guard on "Employee";
create trigger employee_self_update_guard
  before update on "Employee"
  for each row
  execute function enforce_employee_self_update();

drop policy if exists employee_self_update on "Employee";
create policy employee_self_update on "Employee" for update using (
  id = current_employee_id()
) with check (
  id = current_employee_id()
);


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


-- Same three-way shape as TimeEntry itself (owner, their supervisor, or an admin) — every
-- policy here is keyed off the parent TimeEntry's employeeId via timeEntryId, since TimeSession
-- carries no employeeId of its own.
alter table "TimeSession" enable row level security;
alter table "TimeSession" force row level security;

drop policy if exists time_session_select on "TimeSession";
create policy time_session_select on "TimeSession" for select using (
  is_admin()
  or "timeEntryId" in (
    select id from "TimeEntry" where "employeeId" = current_employee_id()
      or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
  )
);

drop policy if exists time_session_write on "TimeSession";
create policy time_session_write on "TimeSession" for all using (
  is_admin()
  or "timeEntryId" in (
    select id from "TimeEntry" where "employeeId" = current_employee_id()
      or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
  )
) with check (
  is_admin()
  or "timeEntryId" in (
    select id from "TimeEntry" where "employeeId" = current_employee_id()
      or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
  )
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


-- Same row-level shape as PtoRequest: self, admin, or that employee's own supervisor may read
-- or write the row. Which FIELDS a given caller may actually set (an employee may create a
-- submission with slots/note but never set status/reviewedBy*; only a supervisor/admin may
-- decide) is enforced at the app layer (src/lib/availability.ts's separate
-- submitAvailability/decideAvailability functions), the same division PtoRequest itself relies
-- on — RLS is row-level, not column-level, here too. Table renamed from EmployeeAvailability
-- to AvailabilitySubmission (prisma/migrations/20260905_rework_availability_to_submissions) —
-- one row per employee is no longer true, so policies just needed the new table name, the
-- actual rules are unchanged.
alter table "AvailabilitySubmission" enable row level security;
alter table "AvailabilitySubmission" force row level security;

drop policy if exists availability_select on "AvailabilitySubmission";
create policy availability_select on "AvailabilitySubmission" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);

drop policy if exists availability_write on "AvailabilitySubmission";
create policy availability_write on "AvailabilitySubmission" for all using (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
) with check (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);


-- Same three-way row shape as PtoRequest/AvailabilitySubmission again: the thread's own
-- employee, their supervisor, or an admin. Keyed off "employeeId" (whose thread this is)
-- only, same as those two tables key off employeeId rather than reviewedById/authorId — who
-- actually WROTE a given message is an app-layer/display concern (src/lib/team-notes.ts sets
-- authorId from the verified caller, never client-supplied), not a row-visibility one.
alter table "TeamNote" enable row level security;
alter table "TeamNote" force row level security;

drop policy if exists team_note_select on "TeamNote";
create policy team_note_select on "TeamNote" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);

drop policy if exists team_note_write on "TeamNote";
create policy team_note_write on "TeamNote" for all using (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
) with check (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);


-- A DirectMessage's visibility is NOT the three-way "self/supervisor/admin" shape every other
-- policy above uses — it's just "did I send or receive this row," full stop, same as any
-- ordinary DM. Deliberately no is_admin() override here: TeamNote/DateTask are HR-facing by
-- design (an admin already has org-wide reach into those), but a DirectMessage is a personal
-- conversation between two teammates that happens to run through this app, not an HR record —
-- flagged to CB as a real design choice she can revisit if she'd rather admins have oversight.
alter table "DirectMessage" enable row level security;
alter table "DirectMessage" force row level security;

drop policy if exists direct_message_select on "DirectMessage";
create policy direct_message_select on "DirectMessage" for select using (
  "senderId" = current_employee_id() or "recipientId" = current_employee_id()
);

drop policy if exists direct_message_write on "DirectMessage";
create policy direct_message_write on "DirectMessage" for all using (
  "senderId" = current_employee_id() or "recipientId" = current_employee_id()
) with check (
  "senderId" = current_employee_id() or "recipientId" = current_employee_id()
);


-- Same three-way row shape as TeamNote just above — a task's own employee, their supervisor,
-- or an admin. Row visibility/writability is still just "is this employeeId's row," same as
-- TeamNote; WHICH of PENDING→COMPLETED→APPROVED a given write is allowed to make is an
-- app-layer concern (src/lib/date-tasks.ts), not an RLS one — same division of labor as
-- team_note_write leaving "who actually wrote this note" to the app layer.
alter table "DateTask" enable row level security;
alter table "DateTask" force row level security;

drop policy if exists date_task_select on "DateTask";
create policy date_task_select on "DateTask" for select using (
  is_admin()
  or "employeeId" = current_employee_id()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);

drop policy if exists date_task_write on "DateTask";
create policy date_task_write on "DateTask" for all using (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
) with check (
  "employeeId" = current_employee_id() or is_admin()
  or "employeeId" in (select id from "Employee" where "supervisorId" = current_employee_id())
);
