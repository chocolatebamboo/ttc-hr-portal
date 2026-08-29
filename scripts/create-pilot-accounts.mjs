// Creates the pilot cohort for roadmap step 12: one HR/Super Admin, one Supervisor, and a
// few Employees who report to that supervisor — real Supabase Auth accounts plus matching
// Employee rows, wired with the org relationships the pilot's workflows need (a supervisor
// with actual reports to approve, employees with an actual supervisor to submit to).
//
// EDIT THE PILOT_TESTERS LIST BELOW FIRST. Every REPLACE_ME must become a real name and a
// real email address before this will run — it refuses to start otherwise, on purpose: this
// sends real invite emails and creates real accounts, so there's no safe "just try it" mode
// with placeholder data.
//
// Usage (from the project root, once Supabase is set up per the README's "Getting set up"):
//   node --env-file=.env.local scripts/create-pilot-accounts.mjs
//
// What it does, per person, in order (safe to re-run — every step checks for an existing
// row/account first rather than erroring or duplicating):
//   1. Invites them via Supabase Auth (email with a link to set their own password — nobody,
//      including whoever runs this script, ever sees or sets a real password for them).
//   2. Creates their Department if it doesn't exist yet.
//   3. Creates their Employee row, linked to that Auth account via userId, with the role and
//      supervisor relationship PILOT_TESTERS describes.
//
// This connects with MIGRATE_DATABASE_URL (the elevated Postgres owner connection used for
// migrations), not DATABASE_URL — deliberately. The running app always goes through the
// RLS-restricted app_user role because every request has to prove whose identity it's acting
// as; this script isn't a request from any employee, it's the one-time act of bringing
// employees into existence in the first place, so there's no employee identity to scope it
// to yet. Nothing about this weakens RLS for the app itself.

import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------------------
// EDIT ME: the actual pilot cohort. Keep the shape (2-3 employees under the one supervisor
// is enough to exercise real approve/return and PTO-decision workflows); change the people.
// employeeCode just needs to be unique — reuse your real numbering scheme if TTC has one.
// ---------------------------------------------------------------------------------------
const PILOT_TESTERS = [
  {
    key: "hr_admin",
    email: "REPLACE_ME@talentedteenclub.org",
    firstName: "REPLACE_ME",
    lastName: "REPLACE_ME",
    jobTitle: "HR Director",
    role: "HR_ADMIN",
    department: "Operations",
    supervisorKey: null,
    employeeCode: "PILOT-001",
  },
  {
    key: "supervisor",
    email: "REPLACE_ME@talentedteenclub.org",
    firstName: "REPLACE_ME",
    lastName: "REPLACE_ME",
    jobTitle: "Program Manager",
    role: "SUPERVISOR",
    department: "Youth Programs",
    supervisorKey: "hr_admin",
    employeeCode: "PILOT-002",
  },
  {
    key: "employee_1",
    email: "REPLACE_ME@talentedteenclub.org",
    firstName: "REPLACE_ME",
    lastName: "REPLACE_ME",
    jobTitle: "Program Coordinator",
    role: "EMPLOYEE",
    department: "Youth Programs",
    supervisorKey: "supervisor",
    employeeCode: "PILOT-003",
  },
  {
    key: "employee_2",
    email: "REPLACE_ME@talentedteenclub.org",
    firstName: "REPLACE_ME",
    lastName: "REPLACE_ME",
    jobTitle: "Program Coordinator",
    role: "EMPLOYEE",
    department: "Youth Programs",
    supervisorKey: "supervisor",
    employeeCode: "PILOT-004",
  },
  // Optional third employee — the brief calls for 2-3. Uncomment and fill in to include one,
  // or duplicate this block for more.
  // {
  //   key: "employee_3",
  //   email: "REPLACE_ME@talentedteenclub.org",
  //   firstName: "REPLACE_ME",
  //   lastName: "REPLACE_ME",
  //   jobTitle: "Program Coordinator",
  //   role: "EMPLOYEE",
  //   department: "Youth Programs",
  //   supervisorKey: "supervisor",
  //   employeeCode: "PILOT-005",
  // },
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Run this with: node --env-file=.env.local scripts/create-pilot-accounts.mjs`);
    process.exit(1);
  }
  return value;
}

function assertNoPlaceholders() {
  const stillPlaceholder = PILOT_TESTERS.filter(
    (t) => t.email.includes("REPLACE_ME") || t.firstName === "REPLACE_ME" || t.lastName === "REPLACE_ME"
  );
  if (stillPlaceholder.length > 0) {
    console.error(
      "PILOT_TESTERS in scripts/create-pilot-accounts.mjs still has REPLACE_ME placeholders " +
        `for: ${stillPlaceholder.map((t) => t.key).join(", ")}.\n` +
        "Edit the list at the top of this file with real names and real email addresses, then run it again.\n" +
        "This refuses to run with placeholder data because it sends real invite emails."
    );
    process.exit(1);
  }
  const emails = PILOT_TESTERS.map((t) => t.email.toLowerCase());
  const dupes = emails.filter((e, i) => emails.indexOf(e) !== i);
  if (dupes.length > 0) {
    console.error(`Duplicate email address(es) in PILOT_TESTERS: ${[...new Set(dupes)].join(", ")}`);
    process.exit(1);
  }
}

async function findAuthUserByEmail(supabaseAdmin, email) {
  // The admin SDK has no direct "get by email" — page through listUsers() and match. Fine at
  // pilot-cohort scale (a handful of people); would need real pagination past a few hundred users.
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureAuthUser(supabaseAdmin, tester) {
  const existing = await findAuthUserByEmail(supabaseAdmin, tester.email);
  if (existing) {
    console.log(`  Auth account already exists for ${tester.email} (no new invite sent).`);
    return existing;
  }

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(tester.email, {
    data: { full_name: `${tester.firstName} ${tester.lastName}` },
  });
  if (error) throw new Error(`Inviting ${tester.email} failed: ${error.message}`);
  console.log(`  Invited ${tester.email} — they'll get an email to set their own password.`);
  return data.user;
}

async function ensureDepartment(prisma, name) {
  return prisma.department.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

async function main() {
  // Checked first, before any env var requirement, since editing PILOT_TESTERS is the very
  // first thing this script's own usage comment tells you to do — no point demanding
  // Supabase/database env vars be correct before telling you the tester list itself isn't.
  assertNoPlaceholders();

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const migrateDatabaseUrl = requireEnv("MIGRATE_DATABASE_URL");

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const prisma = new PrismaClient({ datasourceUrl: migrateDatabaseUrl });

  const employeeIdByKey = new Map();

  try {
    for (const tester of PILOT_TESTERS) {
      console.log(`\n${tester.firstName} ${tester.lastName} (${tester.role}, ${tester.key}):`);

      const authUser = await ensureAuthUser(supabaseAdmin, tester);
      const department = await ensureDepartment(prisma, tester.department);
      const supervisorId = tester.supervisorKey ? employeeIdByKey.get(tester.supervisorKey) : null;
      if (tester.supervisorKey && !supervisorId) {
        throw new Error(
          `${tester.key} lists supervisorKey "${tester.supervisorKey}", but that person hasn't been ` +
            "created yet — list supervisors before their reports in PILOT_TESTERS."
        );
      }

      const employee = await prisma.employee.upsert({
        where: { ttcEmail: tester.email },
        update: {
          userId: authUser.id,
          firstName: tester.firstName,
          lastName: tester.lastName,
          jobTitle: tester.jobTitle,
          role: tester.role,
          departmentId: department.id,
          supervisorId,
        },
        create: {
          userId: authUser.id,
          employeeCode: tester.employeeCode,
          ttcEmail: tester.email,
          firstName: tester.firstName,
          lastName: tester.lastName,
          jobTitle: tester.jobTitle,
          role: tester.role,
          departmentId: department.id,
          supervisorId,
          hireDate: new Date(),
        },
      });
      employeeIdByKey.set(tester.key, employee.id);
      console.log(`  Employee row ready (${employee.id}), supervisor: ${tester.supervisorKey ?? "none"}.`);
    }

    console.log(
      "\nDone. Each pilot tester should have an invite email from Supabase — once they set a " +
        "password they can sign in at your deployed URL. See PILOT_TESTING.md for the workflow " +
        "checklist to run through with them."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message ?? err);
  process.exit(1);
});
