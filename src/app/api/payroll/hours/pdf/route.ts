import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessReports } from "@/lib/authorization";
import { getPayrollHoursReport, InvalidPayrollRangeError } from "@/lib/payroll";
import { toPayrollPdf, payrollPdfFilename } from "@/lib/payroll-format";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/payroll/hours/pdf?start=YYYY-MM-DD&end=YYYY-MM-DD — HR/Super Admin, or (correction
 *  brief #8, Sept 2026) a Supervisor viewing only their own direct reports' hours — same access
 *  rule as /api/payroll/hours, see getPayrollHoursReport's own doc comment. Same report as that
 *  route and its CSV sibling, returned as a downloadable PDF instead (CB, Oct 2026: "let's also
 *  have the option to download pdf"). */
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
    const employeeLabel = employeeId ? report.rows[0]?.employeeCode : undefined;
    const pdf = toPayrollPdf(report, employeeLabel);

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${payrollPdfFilename(report, employeeLabel)}"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
