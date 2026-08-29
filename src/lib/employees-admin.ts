import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CurrentEmployee, EmployeeAdminRowDTO, EmploymentStatus, Role } from "@/types";

export class InvalidEmployeeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEmployeeError";
  }
}

type EmployeeWithRelations = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  ttcEmail: string;
  workPhone: string | null;
  personalPhone: string | null;
  personalEmail: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  jobTitle: string;
  role: string;
  employmentStatus: string;
  departmentId: string | null;
  department: { name: string } | null;
  supervisorId: string | null;
  supervisor: { firstName: string; lastName: string; preferredName: string | null } | null;
  deactivatedAt: Date | null;
  hireDate: Date;
};

function toDTO(e: EmployeeWithRelations): EmployeeAdminRowDTO {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName,
    ttcEmail: e.ttcEmail,
    workPhone: e.workPhone,
    personalPhone: e.personalPhone,
    personalEmail: e.personalEmail,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    emergencyContactRelation: e.emergencyContactRelation,
    jobTitle: e.jobTitle,
    role: e.role as Role,
    employmentStatus: e.employmentStatus as EmploymentStatus,
    departmentId: e.departmentId,
    departmentName: e.department?.name ?? null,
    supervisorId: e.supervisorId,
    supervisorName: e.supervisor
      ? `${e.supervisor.preferredName || e.supervisor.firstName} ${e.supervisor.lastName}`
      : null,
    deactivatedAt: e.deactivatedAt ? e.deactivatedAt.toISOString() : null,
    hireDate: e.hireDate.toISOString(),
  };
}

const RELATIONS_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  ttcEmail: true,
  workPhone: true,
  personalPhone: true,
  personalEmail: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  jobTitle: true,
  role: true,
  employmentStatus: true,
  departmentId: true,
  department: { select: { name: true } },
  supervisorId: true,
  supervisor: { select: { firstName: true, lastName: true, preferredName: true } },
  deactivatedAt: true,
  hireDate: true,
} as const;

/** Admin roster — every employee, active AND deactivated (unlike Directory/roster.ts, which
 *  both deliberately show active employees only), with the full HR record. This is the one
 *  place in the app that reads personalPhone/personalEmail/emergencyContact* and
 *  employeeCode/hireDate/deactivatedAt — fields Directory's own six-column select never asks
 *  the database for at all (see src/lib/directory.ts). */
export async function listEmployeesForAdmin(actor: CurrentEmployee): Promise<EmployeeAdminRowDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employees = await tx.employee.findMany({
      select: RELATIONS_SELECT,
      orderBy: [{ deactivatedAt: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    });
    return employees.map(toDTO);
  });
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

/** Finds an existing Supabase Auth user by email (paginating listUsers — there's no direct
 *  "get by email" in the admin SDK), or invites a new one. Mirrors
 *  scripts/create-pilot-accounts.mjs's ensureAuthUser exactly, just reachable from the app
 *  itself instead of a one-off script — re-adding someone whose Auth account already exists
 *  (e.g. a previously deactivated employee) reuses it rather than erroring or double-inviting. */
async function ensureAuthUser(email: string, fullName: string) {
  const supabaseAdmin = createSupabaseAdminClient();

  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new InvalidEmployeeError(`Couldn't look up existing accounts: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return { user: match, invited: false };
    if (data.users.length < 200) break;
    page += 1;
  }

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });
  if (error) throw new InvalidEmployeeError(`Couldn't send the invite email: ${error.message}`);
  return { user: data.user, invited: true };
}

export interface CreateEmployeeInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  ttcEmail: string;
  jobTitle: string;
  role: Role;
  employmentStatus?: EmploymentStatus;
  departmentName?: string;
  supervisorId?: string;
  hireDate: Date;
  workPhone?: string;
  personalPhone?: string;
  personalEmail?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

/**
 * Adds a new employee: invites them via Supabase Auth (a real email with a link to set their
 * own password — nobody, including the admin running this, ever sees or sets it), then creates
 * their Employee row. This is scripts/create-pilot-accounts.mjs's exact flow, built into the
 * app itself instead of a one-off script an admin has to run from a terminal. The invite is
 * sent BEFORE the database write (outside withRlsContext, since it's a Supabase Auth API call,
 * not a Postgres one) — if the Employee row creation then fails, the Auth account is left
 * invited-but-unlinked rather than silently uninvited; re-submitting the same email reuses that
 * account (ensureAuthUser) rather than erroring.
 */
export async function createEmployee(actor: CurrentEmployee, input: CreateEmployeeInput) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const ttcEmail = input.ttcEmail.trim().toLowerCase();
  const jobTitle = input.jobTitle.trim();

  if (!firstName || !lastName) throw new InvalidEmployeeError("First and last name are required.");
  if (!ttcEmail || !ttcEmail.includes("@")) throw new InvalidEmployeeError("A valid email address is required.");
  if (!jobTitle) throw new InvalidEmployeeError("Job title is required.");
  if (Number.isNaN(input.hireDate.getTime())) throw new InvalidEmployeeError("Choose a valid hire date.");
  if (input.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new InvalidEmployeeError("Only a Super Admin can grant the Super Admin role.");
  }

  const { user } = await ensureAuthUser(ttcEmail, `${firstName} ${lastName}`);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const departmentName = input.departmentName?.trim();
    const department = departmentName
      ? await tx.department.upsert({ where: { name: departmentName }, update: {}, create: { name: departmentName } })
      : null;

    const employeeCount = await tx.employee.count();
    const employeeCode = `EMP-${String(employeeCount + 1).padStart(4, "0")}`;

    try {
      const created = await tx.employee.create({
        data: {
          userId: user.id,
          employeeCode,
          firstName,
          lastName,
          preferredName: input.preferredName?.trim() || null,
          ttcEmail,
          jobTitle,
          role: input.role,
          employmentStatus: input.employmentStatus ?? "ACTIVE",
          departmentId: department?.id ?? null,
          supervisorId: input.supervisorId || null,
          hireDate: input.hireDate,
          workPhone: input.workPhone?.trim() || null,
          personalPhone: input.personalPhone?.trim() || null,
          personalEmail: input.personalEmail?.trim() || null,
          emergencyContactName: input.emergencyContactName?.trim() || null,
          emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
          emergencyContactRelation: input.emergencyContactRelation?.trim() || null,
        },
        select: RELATIONS_SELECT,
      });
      return toDTO(created);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new InvalidEmployeeError(
          "That email (or employee code) is already in use by another employee record."
        );
      }
      throw err;
    }
  });
}

export interface UpdateEmployeeInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  jobTitle: string;
  role: Role;
  employmentStatus: EmploymentStatus;
  departmentName?: string;
  supervisorId?: string;
  hireDate: Date;
  workPhone?: string;
  personalPhone?: string;
  personalEmail?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

/**
 * Edits everything about an employee EXCEPT their login email and their active/deactivated
 * state — email changes would also need to update the linked Supabase Auth account to stay in
 * sync (out of scope for now, see ADMINISTRATOR_INSTRUCTIONS.md), and deactivation is its own
 * dedicated action below so it can't be fat-fingered inside a big edit form. Two lockout guards:
 * an admin can't use this to grant themselves Super Admin from HR Admin (only an existing Super
 * Admin can), and can't use it to demote/remove their OWN admin access (someone else has to do
 * that) — both are about preventing a single admin from accidentally locking the org out of
 * admin access, not about distrust of any particular admin.
 */
export async function updateEmployee(
  actor: CurrentEmployee,
  employeeId: string,
  input: UpdateEmployeeInput
) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const jobTitle = input.jobTitle.trim();

  if (!firstName || !lastName) throw new InvalidEmployeeError("First and last name are required.");
  if (!jobTitle) throw new InvalidEmployeeError("Job title is required.");
  if (Number.isNaN(input.hireDate.getTime())) throw new InvalidEmployeeError("Choose a valid hire date.");
  if (input.supervisorId === employeeId) {
    throw new InvalidEmployeeError("An employee can't be their own supervisor.");
  }
  const ADMIN_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN"];
  if (employeeId === actor.id && !ADMIN_ROLES.includes(input.role)) {
    throw new InvalidEmployeeError("You can't remove your own admin access — ask another admin to do it.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");

    // Only block an actual CHANGE onto/around the Super Admin role for a non-Super-Admin actor
    // — comparing against the row's current role (not just the submitted value) means an
    // HR Admin editing a colleague who already IS a Super Admin can still save an unrelated
    // change (job title, phone, etc.) without that colleague's role in the payload being
    // mistaken for a fresh grant attempt.
    if (input.role !== existing.role && (input.role === "SUPER_ADMIN" || existing.role === "SUPER_ADMIN") && actor.role !== "SUPER_ADMIN") {
      throw new InvalidEmployeeError("Only a Super Admin can change another Super Admin's role.");
    }

    const departmentName = input.departmentName?.trim();
    const department = departmentName
      ? await tx.department.upsert({ where: { name: departmentName }, update: {}, create: { name: departmentName } })
      : null;

    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: {
        firstName,
        lastName,
        preferredName: input.preferredName?.trim() || null,
        jobTitle,
        role: input.role,
        employmentStatus: input.employmentStatus,
        departmentId: department?.id ?? null,
        supervisorId: input.supervisorId || null,
        hireDate: input.hireDate,
        workPhone: input.workPhone?.trim() || null,
        personalPhone: input.personalPhone?.trim() || null,
        personalEmail: input.personalEmail?.trim() || null,
        emergencyContactName: input.emergencyContactName?.trim() || null,
        emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
        emergencyContactRelation: input.emergencyContactRelation?.trim() || null,
      },
      select: RELATIONS_SELECT,
    });
    return toDTO(updated);
  });
}

/** Revokes login access immediately (see getCurrentEmployee's deactivatedAt check) — separate
 *  from employmentStatus, which stays whatever it was; use the edit form for that. Self-
 *  deactivation is blocked so an admin can never accidentally lock themselves out. */
export async function deactivateEmployee(actor: CurrentEmployee, employeeId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (employeeId === actor.id) throw new InvalidEmployeeError("You can't deactivate your own account.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { deactivatedAt: new Date() },
      select: RELATIONS_SELECT,
    });
    return toDTO(updated);
  });
}

export async function reactivateEmployee(actor: CurrentEmployee, employeeId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { deactivatedAt: null },
      select: RELATIONS_SELECT,
    });
    return toDTO(updated);
  });
}
