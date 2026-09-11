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
alter
