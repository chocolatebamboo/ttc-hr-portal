import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { todayDateKey } from "@/lib/time";
import type { AdminAttendanceRowDTO, CurrentEmployee } from "@/types";

/**
 * HR-wide attendance dashboard (src/app/(portal)/admin/attendance) — one row per active
 * employee for the selected week, admin-only. Unlike the supervisor "My Team" list
 * (src/lib/roster.ts / /api/team/reports), this deliberately covers every active employee
 * regardless of who supervises them, which is exactly what is_admin() in prisma/rls.sql's
 * time_entry_select policy already grants: an admin identity can read every TimeEntry row,
 * so this needs no new RLS policy — just no employeeId filter in the query below.
 */
export async function listAdminAttendance(
  actor: CurrentEmployee,
  weekStart: string,
  weekEnd: string,
  departmentId?: string
): Promise<AdminAttendanceRowDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employees = await tx.employee.findMany({
      where: {
        deactivatedAt: null,
        ...(departmentId ? { departmentId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        jobTitle: true,
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const entries = await tx.timeEntry.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        workDate: {
          gte: new Date(`${weekStart}T00:00:00.000Z`),
          lte: new Date(`${weekEnd}T00:00:00.000Z`),
        },
      },
      select: { employeeId: true, workDate: true, status: true, clockIn: true, clockOut: true },
    });

    // A day still in progress today isn't "missing" yet — only a past day left with a
    // clock-in and no clock-out counts, so today's still-open entry doesn't falsely flag.
    const today = todayDateKey();

    const awaitingByEmployee = new Map<string, number>();
    const missingByEmployee = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status === "AWAITING_APPROVAL") {
        awaitingByEmployee.set(entry.employeeId, (awaitingByEmployee.get(entry.employeeId) ?? 0) + 1);
      }
      const workDateKey = entry.workDate.toISOString().slice(0, 10);
      if (entry.clockIn && !entry.clockOut && workDateKey < today) {
        missingByEmployee.set(entry.employeeId, (missingByEmployee.get(entry.employeeId) ?? 0) + 1);
      }
    }

    return employees.map((e) => ({
      employeeId: e.id,
      name: `${e.preferredName || e.firstName} ${e.lastName}`,
      jobTitle: e.jobTitle,
      department: e.department?.name ?? null,
      awaitingApprovalCount: awaitingByEmployee.get(e.id) ?? 0,
      missingClockOutCount: missingByEmployee.get(e.id) ?? 0,
    }));
  });
}
