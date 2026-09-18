import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessReports } from "@/lib/authorization";
import { getPayrollHoursReport, InvalidPayrollRangeError } from "@/lib/payroll";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/payroll/hours?start=YYYY-MM-DD&end=YYYY-MM-DD — HR/Super Admin, or (correction
 *  brief #8, Sept 2026) a Supervisor viewing only their own direct reports' hours; see
 *  getPayrollHoursReport's own doc comment for the scoping. The preview the Reports page's
 *  table renders; /api/payroll/hours/csv returns the same numbers as a downloadable file. */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    assertCanAccessReports(employee);

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const employeeId = searchParams.get("employeeId") || undefined;
    if (!start || !end) {
      throw new InvalidPayrollRangeError("Choose a start and end date.");
    }

    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T23:59:59.999Z`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new InvalidPayrollRangeError("Choose valid start and end dates.");
    }

    const report = await getPayrollHoursReport(employee, startDate, endDate, employeeId);
    return NextResponse.json(report);
  } catch (err) {
    return toErrorResponse(err);
  }
}
