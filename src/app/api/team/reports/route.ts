import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";
import type { DirectReportDTO } from "@/types";

/**
 * GET /api/team/reports — the caller's own direct reports (RLS's employee_select policy
 * already limits "Employee" rows visible to a non-admin caller to: themselves, and anyone
 * whose supervisorId is them — so this query can't return someone else's team even if the
 * WHERE clause below were wrong).
 */
export async function GET() {
  try {
    const reviewer = await requireEmployee();

    const reports = await withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
      const employees = await tx.employee.findMany({
        where: { supervisorId: reviewer.id },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });

      const withCounts: DirectReportDTO[] = await Promise.all(
        employees.map(async (e) => {
          const [awaitingApprovalCount, pendingPtoCount] = await Promise.all([
            tx.timeEntry.count({ where: { employeeId: e.id, status: "AWAITING_APPROVAL" } }),
            tx.ptoRequest.count({ where: { employeeId: e.id, status: "PENDING" } }),
          ]);
          return {
            id: e.id,
            firstName: e.firstName,
            lastName: e.lastName,
            preferredName: e.preferredName,
            jobTitle: e.jobTitle,
            employmentStatus: e.employmentStatus,
            awaitingApprovalCount,
            pendingPtoCount,
          };
        })
      );
      return withCounts;
    });

    return NextResponse.json({ reports });
  } catch (err) {
    return toErrorResponse(err);
  }
}
