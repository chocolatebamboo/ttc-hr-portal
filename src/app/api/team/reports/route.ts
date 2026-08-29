import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";
import type { DirectReportDTO } from "@/types";

/**
 * GET /api/team/reports — the caller's own direct reports.
 *
 * Unlike most queries in this app, the `where: { supervisorId: reviewer.id }` below is doing
 * the actual narrowing by itself — employee_select (prisma/rls.sql) now allows any active
 * employee's row through to any authenticated caller (the Directory needs that), so RLS is no
 * longer an independent backstop for THIS specific query the way it still is for, say,
 * time entries or PTO. If this WHERE clause were ever removed or weakened, this route would
 * start returning every active employee, not just the reviewer's own team. Worth remembering
 * before "simplifying" this query.
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
