import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { getPayrollHoursReport, InvalidPayrollRangeError } from "@/lib/payroll";
import { toPayrollCsv, payrollCsvFilename } from "@/lib/payroll-format";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/payroll/hours/csv?start=YYYY-MM-DD&end=YYYY-MM-DD — HR/Super Admin only. Same
 *  report as /api/payroll/hours, returned as a downloadable CSV instead of JSON. */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (!start || !end) {
      throw new InvalidPayrollRangeError("Choose a start and end date.");
    }

    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T23:59:59.999Z`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new InvalidPayrollRangeError("Choose valid start and end dates.");
    }

    const report = await getPayrollHoursReport(employee, startDate, endDate);
    const csv = toPayrollCsv(report);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${payrollCsvFilename(report)}"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
