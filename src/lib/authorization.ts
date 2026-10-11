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
 * Oct 2026 (CB, asked directly after flagging that Daijour's sidebar was missing Attendance and
 * PTO Management: "Yes — give him Attendance + PTO Management for his own team"): same three-
 * role "staff" cut canAccessReports already draws, given its own name per this file's existing
 * convention (see canAccessReports's own doc comment on why a logically-identical check still
 * gets its own name per capability). Safe for the same reason canAccessReports is: the two admin
 * pages this gates (listAdminAttendance, listAdminPto) both narrow what a non-admin actually
 * sees down to their own direct reports — isAdmin(actor) ? {} : { supervisorId: actor.id }, the
 * same shape listAdminShifts/listCurrentlyClockedIn/getPayrollHoursReport already use — not a
 * blanket grant of company-wide data to a Supervisor.
 */
export function canAccessAttendance(actor: CurrentEmployee): boolean {
  return isAdmin(actor) || actor.role === "SUPERVISOR";
}

export function assertCanAccessAttendance(actor: CurrentEmployee): void {
  if (!canAccessAttendance(actor)) throw new ForbiddenError();
}

/** Same rule and reasoning as canAccessAttendance just above, for the standalone PTO Management
 *  admin page (src/app/(portal)/admin/pto) — kept as its own named function rather than reusing
 *  canAccessAttendance so call sites read as what they're actually gating. */
export function canAccessPtoManagement(actor: CurrentEmployee): boolean {
  return isAdmin(actor) || actor.role === "SUPERVISOR";
}

export function assertCanAccessPtoManagement(actor: CurrentEmployee): void {
  if (!canAccessPtoManagement(actor)) throw new ForbiddenError();
}

/**
 * Same rule and reasoning as canAccessAttendance/canAccessPtoManagement just above, for the
 * standalone Team Availability admin page (src/app/(portal)/admin/availability) — kept as its
 * own named function per this file's convention. listAdminAvailability (src/lib/availability.ts)
 * already does its own authorization AND scoping independently of this function (admin sees
 * every submission org-wide; a Supervisor is narrowed to supervisorId = their own id) — this
 * gates the PAGE itself, which until Oct 2026 called isAdmin() directly and redirected every
 * Supervisor straight back to /dashboard before that downstream scoping ever got a chance to
 * run. Found Oct 2026 (CB, comparing Daijour's sidebar to her own: "it's not looking exactly
 * kind of like mine where the team availability is the main and then the breakdown") while
 * nesting Attendance/PTO Management/Team Schedule under a Team Availability parent for
 * SUPERVISOR_NAV the same way ADMIN_NAV already does — that parent link needed somewhere real to
 * go.
 */
export function canAccessTeamAvailability(actor: CurrentEmployee): boolean {
  return isAdmin(actor) || actor.role === "SUPERVISOR";
}

export function assertCanAccessTeamAvailability(actor: CurrentEmployee): void {
  if (!canAccessTeamAvailability(actor)) throw new ForbiddenError();
}

/**
 * Team Tasks admin page (src/app/(portal)/admin/tasks) — CB, Oct 2026: "a sub dropdown menu on
 * my tasks... for like the admin's team member tasks... so we could see the team members
 * task... holistic with all the different team members." Same three-role "staff" cut
 * canAccessAttendance/canAccessReports already draw, given its own name here per this file's
 * own established convention (see canAccessReports's doc comment on why a logically-identical
 * check still gets its own name per capability). Safe for the same reason those are: the data
 * function this gates (listTeamDateTasksForPeriod in src/lib/date-tasks.ts) narrows what a
 * non-admin actually sees down to their own direct reports — isAdmin(actor) ? {} :
 * { supervisorId: actor.id }, the same shape listAdminAttendance/listAdminShifts/
 * listAllAwaitingReviewDateTasks already use — not a blanket grant of company-wide data to a
 * Supervisor.
 */
export function canAccessTeamTasks(actor: CurrentEmployee): boolean {
  return isAdmin(actor) || actor.role === "SUPERVISOR";
}

export function assertCanAccessTeamTasks(actor: CurrentEmployee): void {
  if (!canAccessTeamTasks(actor)) throw new ForbiddenError();
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
 * Home dashboard's admin-style view (AdminHomeHero, TeamScheduleGlance, the pending Team
 * availability queue, the Reports stat tile) — CB, Sept 2026: "Daijour['s]... role... user
 * experience isn't looking like what we [see as] admin... we need to make sure that's working."
 * Daijour is SUPERVISOR, not HR_ADMIN/SUPER_ADMIN, so isAdmin() alone left him on the plain-
 * employee Home layout even though he already has real team-management authority elsewhere in
 * this app (canAccessReports, assertCanReviewTimesheet and friends below, the /team/
 * [employeeId] pages) — this closes that gap for the Home dashboard specifically. Same
 * three-role "staff" cut isStaff/canAccessReports already draw — named separately here, like
 * those two, so dashboard/page.tsx's call sites read as what they're actually gating rather
 * than borrowing a DM- or Reports-flavored name for an unrelated capability.
 *
 * Confirmed with CB: this stays scoped exactly like everywhere else a Supervisor already has
 * reach (listAdminShifts's own supervisorId narrowing, Reports) rather than opening company-wide
 * visibility — a Supervisor's admin-style Home shows only their own direct reports, an admin's
 * still shows everyone. See listAdminShifts (src/lib/shifts.ts) and listAdminAvailability
 * (src/lib/availability.ts), both of which narrow their own query by supervisorId for a
 * non-admin caller rather than relying on this function to do that scoping.
 */
export function canSeeAdminHomeDashboard(actor: CurrentEmployee): boolean {
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
