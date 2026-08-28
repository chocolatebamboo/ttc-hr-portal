import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessEmployeeRecords } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/time/timesheet?employeeId=...&start=YYYY-MM-DD&end=YYYY-MM-DD
 * employeeId defaults to the caller. Requesting anyone else's requires the caller to be
 * that employee's supervisor or an HR/Super Admin — checked server-side against the
 * database relationship, then enforced again by Postgres RLS inside withRlsContext.
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);
    const targetEmployeeId = searchParams.get("employeeId") ?? employee.id;

    await assertCanAccessEmployeeRecords(employee, targetEmployeeId);

    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (!start || !end) {
      return NextResponse.json({ error: "start and end query params are required." }, { status: 400 });
    }

    const entries = await withRlsContext({ employeeId: employee.id, role: employee.role }, async (tx) => {
      const rows = await tx.timeEntry.findMany({
        where: {
          employeeId: targetEmployeeId,
          workDate: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T23:59:59.999Z`) },
        },
        orderBy: { workDate: "asc" },
      });

      // Surface the reason a returned entry was returned — pulled from the audit trail
      // (the single source of truth for review history) rather than duplicated onto
      // TimeEntry itself.
      return Promise.all(
        rows.map(async (row) => {
          if (row.status !== "RETURNED") return { ...row, reviewComment: null };
          const lastReturn = await tx.timeEntryAuditEvent.findFirst({
            where: { timeEntryId: row.id, action: "TIMESHEET_RETURNED" },
            orderBy: { createdAt: "desc" },
          });
          return { ...row, reviewComment: lastReturn?.comment ?? null };
        })
      );
    });

    return NextResponse.json({ entries });
  } catch (err) {
    return toErrorResponse(err);
  }
}
