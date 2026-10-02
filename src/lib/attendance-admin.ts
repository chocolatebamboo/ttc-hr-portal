import { withRlsContext } from "@/lib/db";
import { isAdmin, canAccessAttendance, ForbiddenError } from "@/lib/authorization";
import { todayDateKey } from "@/lib/time";
import { getAvatarPublicUrl } from "@/lib/storage";
import type { AdminAttendanceRowDTO, CurrentEmployee, CurrentlyClockedInRowDTO } from "@/types";

/**
 * Attendance dashboard (src/app/(portal)/admin/attendance) — one row per active employee for
 * the selected week. HR/Super Admin: every active employee, regardless of who supervises them,
 * which is exactly what is_admin() in prisma/rls.sql's time_entry_select policy already grants.
 *
 * Opened to Supervisor too (Oct 2026, CB: "give him Attendance... for his own team" — see
 * canAccessAttendance's own doc comment): narrowed to the caller's own direct reports via the
 * explicit `supervisorId` filter below, same belt-and-suspenders shape as listCurrentlyClockedIn
 * just below in this file (time_entry_select's RLS policy already independently grants a
 * supervisor this same read for their own reports, but Employee rows themselves are visible
 * company-wide via employee_select for directory purposes — see that policy's own comment in
 * prisma/rls.sql — so this query can't just lean on RLS alone to narrow who shows up here).
 */
export async function listAdminAttendance(
  actor: CurrentEmployee,
  weekStart: string,
  weekEnd: string,
  departmentId?: string
): Promise<AdminAttendanceRowDTO[]> {
  if (!canAccessAttendance(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employees = await tx.employee.findMany({
      where: {
        deactivatedAt: null,
        ...(isAdmin(actor) ? {} : { supervisorId: actor.id }),
        ...(departmentId ? { departmentId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        jobTitle: true,
        department: { select: { name: true } },
        avatarStorageKey: true,
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
      select: {
        employeeId: true,
        workDate: true,
        status: true,
        sessions: { select: { clockOut: true } },
      },
    });

    // A day still in progress today isn't "missing" yet — only a PAST day left with an open
    // session (clocked in, never clocked back out) counts, so today's still-open session
    // doesn't falsely flag while the employee is simply still working.
    const today = todayDateKey();

    const awaitingByEmployee = new Map<string, number>();
    const missingByEmployee = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status === "AWAITING_APPROVAL") {
        awaitingByEmployee.set(entry.employeeId, (awaitingByEmployee.get(entry.employeeId) ?? 0) + 1);
      }
      const workDateKey = entry.workDate.toISOString().slice(0, 10);
      const hasOpenSession = entry.sessions.some((s) => s.clockOut === null);
      if (hasOpenSession && workDateKey < today) {
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
      avatarUrl: e.avatarStorageKey ? getAvatarPublicUrl(e.avatarStorageKey) : null,
    }));
  });
}

/**
 * "Clocked in now" (CB, Oct 2026): "were supposed to see the clock running when the team clocks
 * in, that is very important" — raised alongside a report that Donique's clock-out "didn't
 * record at all." Direct database inspection showed her session actually DID record correctly
 * end-to-end; the real gap was that nothing anywhere showed a supervisor/admin which team
 * members are actually clocked in right now — only who's SCHEDULED to be (TeamScheduleGlance,
 * fed by listAdminShifts), a different thing entirely from a real clock punch. This reads real
 * TimeSession rows directly: every session across the org (or, for a Supervisor, just their own
 * direct reports) that's still open — clockOut null — right now.
 *
 * Same admin-sees-everyone / supervisor-sees-own-reports shape as listAdminShifts (src/lib/
 * shifts.ts): isAdmin() sees every active employee, a Supervisor is narrowed to
 * supervisorId = their own id. time_session_select (prisma/rls.sql) already grants exactly this
 * same read independently (admin, or "employeeId" under my own supervisorId) — this query's own
 * filter is the same belt-and-suspenders the rest of this file and listAdminShifts already keep,
 * not something RLS leaves open on its own.
 *
 * Deliberately NOT filtered by todayDateKey()/workDate — a session still open from before
 * midnight is still genuinely running, and catching exactly that (not just "today's" sessions)
 * is the point of a "right now" view. Ordered oldest-clocked-in-first so whoever's been in
 * longest — the one most likely to need a nudge — sorts to the top.
 */
export async function listCurrentlyClockedIn(actor: CurrentEmployee): Promise<CurrentlyClockedInRowDTO[]> {
  if (actor.role !== "SUPERVISOR" && !isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const sessions = await tx.timeSession.findMany({
      where: {
        clockOut: null,
        timeEntry: {
          employee: {
            deactivatedAt: null,
            ...(isAdmin(actor) ? {} : { supervisorId: actor.id }),
          },
        },
      },
      select: {
        id: true,
        clockIn: true,
        isException: true,
        exceptionReason: true,
        timeEntry: {
          select: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                preferredName: true,
                jobTitle: true,
                department: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { clockIn: "asc" },
    });

    return sessions.map((s) => ({
      sessionId: s.id,
      employeeId: s.timeEntry.employee.id,
      name: `${s.timeEntry.employee.preferredName || s.timeEntry.employee.firstName} ${s.timeEntry.employee.lastName}`,
      jobTitle: s.timeEntry.employee.jobTitle,
      department: s.timeEntry.employee.department?.name ?? null,
      clockIn: s.clockIn.toISOString(),
      isException: s.isException,
      exceptionReason: s.exceptionReason,
    }));
  });
}
