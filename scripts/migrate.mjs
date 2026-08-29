// Thin wrapper behind the `db:migrate` / `db:deploy` npm scripts.
//
// prisma/schema.prisma's datasource always reads DATABASE_URL — the same restricted,
// non-superuser `app_user` role the deployed app connects as (see README "3. Environment
// variables"). That role deliberately has no CREATE/ALTER/DROP privileges (see prisma/rls.sql,
// section 1) — RLS only protects anything if the app itself can never run DDL. `prisma migrate`
// needs those DDL privileges, so this swaps in MIGRATE_DATABASE_URL (the elevated `postgres`
// role, .env.local-only, never used by the running app) for DATABASE_URL just for this one
// child process. Nothing else changes — .env.local on disk, and this shell's real DATABASE_URL,
// are both left untouched.
import { spawnSync } from "node:child_process";

if (!process.env.MIGRATE_DATABASE_URL) {
  console.error(
    "MIGRATE_DATABASE_URL is not set. Add it to .env.local — see README.md, " +
      "'3. Environment variables'."
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: process.env.MIGRATE_DATABASE_URL },
});
process.exit(result.status ?? 1);
