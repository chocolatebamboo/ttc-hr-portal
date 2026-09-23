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
 * Correction brief #8 (Sept 2026), "Administrative access and role audit": "accessing reports"
 * is one of the capabilities explicitly named for BOTH people identified for operational
 * administrative functionality — Shawn Ho-Hing (HR_ADMIN, already covered by isAdmin()) and
 * Daijour Ho-Hing (SUPERVISOR, who wasn't covered by anything before this). Extending Reports
 * to every Supervisor (not just Daijour by name — roles are global, not per-user) is safe
 * *because* getPayrollHoursReport scopes what a non-admin actually sees down to their own
 * direct reports, the exact same "supervisorId = actor.id" narrowing every other
 * supervisor-facing capability in this app already uses (see assertCanReviewTimesheet and
 * friends below) — this is not a blanket grant of company-wide data to a Manager-level role.
 * Activity History (the org-wide audit trail, a different tab on the same Reports page) stays
 * admin-only — AuditLog has no per-employee column to scope it by the way TimeEntry/PtoRequest
 * do, and the brief's own audit instruction is "don't grant a capability the existing intended
 * permission model doesn't support" — so ReportsView hides that tab outright for a Supervisor
 * rather than exposing something whose one guard is a component-level tab that just happens to
 * not be visible (the API route underneath is still separately admin-only either way).
 */
export function canAccessReports(actor: CurrentEmployee): boolean {
  return isAdmin(actor) || actor.role === "SUPERVISOR";
}

export function assertCanAccessReports(actor: CurrentEmployee): void {
  if (!canAccessReports(actor)) throw new ForbiddenError();
}

/**
 * Phase 5c (CB, Sept 2026): "an option to add an internal comment" on a direct message,
 * confirmed scope "hidden from the team member." Same three-role "staff" cut canAccessReports
 * already draws (isAdmin() plus SUPERVISOR) — given its own name here since internal DM notes
 * and Reports access aren't otherwise related capabilities, and "isStaff" reads more plainly at
 * the DM comment call sites than reusing canAccessReports would. prisma/rls.sql's
 * direct_message_comment_select/_insert enforce the same cut independently, via
 * current_role_name() <> 'EMPLOYEE'.
 */
export function isStaff(actor: CurrentEmployee): boolean {
  return isAdmin(actor) || actor.role === "SUPERVISOR";
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

/** Same rule again, for pushing (and later approving) a date task onto a team member — CB,
 *  Sept 2026: only an admin or that person's supervisor pushes a task, same authority as
 *  reviewing their availability or PTO, never the employee assigning one to themselves. */
export async function assertCanAssignTasks(
  actor: CurrentEmployee,
  targetEmployeeId: string
): Promise<void> {
  if (isAdmin(actor)) return;
  if (actor.role !== "SUPERVISOR") throw new ForbiddenError();
  await assertCanAccessEmployeeRecords(actor, targetEmployeeId);
}

/** Same rule again, for converting approved availability into a confirmed Shift, creating one
 *  manually, or cancelling/reassigning one — client spec (Sept 2026): scheduling is a
 *  supervisor/admin action, never something a team member does to their own record (a confirmed
 *  shift can only be changed through a Request Shift Change / Request Cancellation, not a direct
 *  edit — see Shift's own doc comment in prisma/schema.prisma). Same authority as reviewing that
 *  employee's availability/PTO/timesheet — one relationship, checked the same way everywhere. */
export async function assertCanManageShifts(
  actor: CurrentEmployee,
  targetEmployeeId: string
): Promise<void> {
  if (isAdmin(actor)) return;
  if (actor.role !== "SUPERVISOR") throw new ForbiddenError();
  await assertCanAccessEmployeeRecords(actor, targetEmployeeId);
}
