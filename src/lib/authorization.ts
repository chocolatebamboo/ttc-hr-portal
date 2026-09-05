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

/** For admin-only routes (document management, etc.) where there's no target employee to
 *  check a relationship against — the actor's role alone decides it. */
export function assertIsAdmin(actor: CurrentEmployee): void {
  if (!isAdmin(actor)) throw new ForbiddenError();
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
    // Import locally to avoid a circular import between auth libs. Reads under the ACTOR's
    // own RLS identity — not a bare, unscoped `prisma` call — because employee_select
    // requires a set identity to allow anything through (see prisma/rls.sql). A supervisor
    // querying a real report of theirs matches employee_select's own "supervisorId = me"
    // clause and the row comes back; querying anyone else still resolves (the directory-style
    // clause makes any active employee's row visible to an authenticated caller), so the
    // actual narrowing happens right here, in the comparison below — RLS decided the row
    // could be READ, this decides whether the caller may ACT on it.
    const { withRlsContext } = await import("@/lib/db");
    const target = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
      tx.employee.findUnique({
        where: { id: targetEmployeeId },
        select: { supervisorId: true },
      })
    );
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

/** Same rule as assertCanReviewTimesheet, for onboarding step approvals — kept as its own
 *  named function (rather than a shared generic) so call sites read as what they're actually
 *  gating, not a repurposed timesheet check. */
export async function assertCanReviewOnboarding(
  actor: CurrentEmployee,
  targetEmployeeId: string
): Promise<void> {
  if (isAdmin(actor)) return;
  if (actor.role !== "SUPERVISOR") throw new ForbiddenError();
  await assertCanAccessEmployeeRecords(actor, targetEmployeeId);
}

/** Same rule again, for deciding a team member's submitted weekly availability — a
 *  supervisor's authority over their own reports' PTO/timesheets/onboarding is one
 *  relationship, not a separate one to keep in sync per feature. */
export async function assertCanReviewAvailability(
  actor: CurrentEmployee,
  targetEmployeeId: string
): Promise<void> {
  if (isAdmin(actor)) return;
  if (actor.role !== "SUPERVISOR") throw new ForbiddenError();
  await assertCanAccessEmployeeRecords(actor, targetEmployeeId);
}
