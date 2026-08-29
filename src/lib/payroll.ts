import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import type { CurrentEmployee, PayrollHoursReportDTO, PayrollHoursRowDTO } from "@/types";

export class InvalidPayrollRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayrollRangeError";
  }
}

/**
 * The payroll hours export — per the brief, this is explicitly HOURS, not payroll: no rate,
 * no overtime multiplier, no tax withholding, nothing TTC's payroll company already owns. Two
 * sources feed it, both scoped to [start, end] inclusive:
 *
 *  - Regular hours: TimeEntry.totalMinutes for entries with status APPROVED only. A day that's
 *    still in progress, awaiting a supervisor's review, or returned for correction contributes
 *    nothing — see unapprovedEntryCount below for why that matters.
 *  - PTO hours: PtoRequest.hours for requests with status APPROVED only, broken out by type.
 *    A request is included if its date range overlaps the period AT ALL — since hours is one
 *    total for the whole request rather than a per-day figure, a request that spans a period
 *    boundary is counted in full here rather than split/prorated. That's a real simplification,
 *    not a bug: it's called out in the UI so HR can sanity-check any boundary-spanning request
 *    by hand before running payroll on it.
 */
export async function getPayrollHoursReport(
  actor: CurrentEmployee,
  startDate: Date,
  endDate: Date
): Promise<PayrollHoursReportDTO> {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (endDate < startDate) {
    throw new InvalidPayrollRangeError("End date must be on or after the start date.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employees = await tx.employee.findMany({
      where: { deactivatedAt: null },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const timeEntries = await tx.timeEntry.findMany({
      where: { workDate: { gte: startDate, lte: endDate } },
      select: { employeeId: true, status: true, totalMinutes: true },
    });

    const ptoRequests = await tx.ptoRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { employeeId: true, type: true, hours: true },
    });

    const unapprovedEntryCount = timeEntries.filter(
      (e: { status: string }) => e.status !== "APPROVED"
    ).length;

    const regularMinutesByEmployee = new Map<string, number>();
    for (const entry of timeEntries) {
      if (entry.status !== "APPROVED" || entry.totalMinutes == null) continue;
      regularMinutesByEmployee.set(
        entry.employeeId,
        (regularMinutesByEmployee.get(entry.employeeId) ?? 0) + entry.totalMinutes
      );
    }

    const ptoHoursByEmployee = new Map<string, { VACATION: number; SICK: number; PERSONAL: number; OTHER_APPROVED_LEAVE: number }>();
    for (const req of ptoRequests) {
      const bucket = ptoHoursByEmployee.get(req.employeeId) ?? {
        VACATION: 0,
        SICK: 0,
        PERSONAL: 0,
        OTHER_APPROVED_LEAVE: 0,
      };
      bucket[req.type as keyof typeof bucket] += req.hours;
      ptoHoursByEmployee.set(req.employeeId, bucket);
    }

    const rows: PayrollHoursRowDTO[] = employees.map((e) => {
      const regularHours = round2((regularMinutesByEmployee.get(e.id) ?? 0) / 60);
      const pto = ptoHoursByEmployee.get(e.id) ?? { VACATION: 0, SICK: 0, PERSONAL: 0, OTHER_APPROVED_LEAVE: 0 };
      const vacationHours = round2(pto.VACATION);
      const sickHours = round2(pto.SICK);
      const personalHours = round2(pto.PERSONAL);
      const otherLeaveHours = round2(pto.OTHER_APPROVED_LEAVE);
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: `${e.preferredName || e.firstName} ${e.lastName}`,
        department: e.department?.name ?? null,
        regularHours,
        vacationHours,
        sickHours,
        personalHours,
        otherLeaveHours,
        totalHours: round2(regularHours + vacationHours + sickHours + personalHours + otherLeaveHours),
      };
    });

    // Only employees with SOME hours in the period are worth a payroll company's attention —
    // an all-zero row for someone who simply didn't work that period is noise, not data.
    const nonZeroRows = rows.filter((r) => r.totalHours > 0);

    return {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      rows: nonZeroRows,
      unapprovedEntryCount,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
