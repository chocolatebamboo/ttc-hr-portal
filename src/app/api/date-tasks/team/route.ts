import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessTeamTasks } from "@/lib/authorization";
import { listTeamDateTasksForPeriod } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/team?start=&end= — every active team member's own tasks for one pay
 *  period, any status, org-wide for HR/Super Admin or narrowed to a Supervisor's own direct
 *  reports (listTeamDateTasksForPeriod itself enforces/narrows this). Backs the Team Tasks
 *  admin page (src/app/(portal)/admin/tasks) — a static sibling of the [id] routes in this
 *  folder, same shape as the existing awaiting-review/recently-approved routes, just with a
 *  date-range query string since this one is paged by pay period rather than a flat queue. */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    assertCanAccessTeamTasks(employee);

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (!start || !end) {
      return NextResponse.json({ error: "start and end are required." }, { status: 400 });
    }

    const rows = await listTeamDateTasksForPeriod(employee, start, end);
    return NextResponse.json({ rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
