import type { CurrentEmployee, Role } from "@/types";

/**
 * App-layer authorization — the FIRST line of defense (RLS in prisma/rls.sql is the second,
 * independent one). Every function here answers one question only: is `actor` allowed to
 * do this to `targetEmployeeId`? Nothing in this file trusts a role or id supplied by the
 * client — `actor` must come from requireEmployee(), which reads it from the verified
 * session.
 */

export class ForbiddenError extends Error {
  constructor(message = "You don't have access to this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

const ADMIN_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN"];

export function isAdmin(actor: CurrentEmployee): boolean {
  return ADMIN_ROLES.includes(actor.role);
}

/**
 * True if `actor` may view/act on `targetEmployeeId`'s work-related records (time entries,
 * PTO). Admins: anyone. Supervisors: their direct reports only — checked against the
 * database, not a client-supplied "I am their supervisor" claim. Employees: themselves only.
 */
export async function canAccessEmployeeRecords(
  actor: CurrentEmployee,
  targetEmployeeId: string
): Promise<boolean> {
  if (isAdmin(actor)) return true;
  if (actor.id === targetEmployeeId) return true;

  if (actor.role === "SUPERVISOR") {
    // Import locally to avoid a circular import between auth libs.
    const { prisma } = await import("@/lib/db");
    const target = await prisma.employee.findUnique({
      where: { id: targetEmployeeId },
      select: { supervisorId: true },
    });
    return target?.supervisorId === actor.id;
  }

  return false;
}

export async function assertCanAccessEmployeeRecords(
  actor: CurrentEmployee,
  targetEmployeeId: string
): Promise<void> {
  if (!(await canAccessEmployeeRecords(actor, targetEmployeeId))) {
    throw new ForbiddenError();
  }
}

/** Only a supervisor of the given employee (or an admin) may approve/return their timesheet. */
export async function assertCanReviewTimesheet(
  actor: CurrentEmployee,
  targetEmployeeId: string
): Promise<void> {
  if (isAdmin(actor)) return;
  if (actor.role !== "SUPERVISOR") throw new ForbiddenError();
  await assertCanAccessEmployeeRecords(actor, targetEmployeeId);
}
