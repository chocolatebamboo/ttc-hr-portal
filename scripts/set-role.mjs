// One-off bootstrap tool: sets an existing employee's Role directly in the database.
//
// Why this exists: the Employees admin page can't create the very first Super Admin. Only a
// Super Admin can grant the Super Admin role from that page, and nobody — Super Admin
// included — can change their own role from it (that's the self-lockout guard working as
// intended). Until at least one Super Admin account exists, there's no in-app way to create
// one. This script is that one-time (or rare) escape hatch, run by hand, not exposed anywhere
// in the app itself.
//
// Usage (from the project root, once Supabase/`.env.local` are set up per the README):
//   node --env-file=.env.local scripts/set-role.mjs someone@talentedteenclub.org SUPER_ADMIN
//
// Like scripts/create-pilot-accounts.mjs, this connects with MIGRATE_DATABASE_URL (the
// elevated Postgres owner connection used for migrations), not DATABASE_URL — deliberately.
// The running app always goes through the RLS-restricted app_user role because every request
// has to prove whose employee identity it's acting as; this script isn't a request from any
// employee, it's a direct, human-run administrative action, so there's no identity to scope
// it to. Nothing about running this weakens RLS for the app itself.

import { PrismaClient } from "@prisma/client";

const VALID_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "SUPERVISOR", "EMPLOYEE"];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run this with: node --env-file=.env.local scripts/set-role.mjs <email> <ROLE>`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    console.error("Usage: node --env-file=.env.local scripts/set-role.mjs <email> <ROLE>");
    console.error(`ROLE must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_ROLES.includes(role)) {
    console.error(`"${role}" isn't a valid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const migrateDatabaseUrl = requireEnv("MIGRATE_DATABASE_URL");
  const prisma = new PrismaClient({ datasourceUrl: migrateDatabaseUrl });

  try {
    const employee = await prisma.employee.findUnique({ where: { ttcEmail: email } });
    if (!employee) {
      console.error(`No employee found with ttcEmail "${email}". Check the address and try again.`);
      process.exit(1);
    }

    if (employee.role === role) {
      console.log(`${email} is already ${role} — nothing to change.`);
      return;
    }

    await prisma.employee.update({ where: { id: employee.id }, data: { role } });
    console.log(`Done. ${email}: ${employee.role} -> ${role}.`);
    console.log("They'll need to sign out and back in (or just refresh) to see the new admin nav links.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message ?? err);
  process.exit(1);
});
