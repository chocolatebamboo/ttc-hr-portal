import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listDateTasks, createDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/[id] — that employee's tasks, self/supervisor/admin only. Segment is
 *  named `id` (not `employeeId`) because Next.js requires every route sharing this folder
 *  depth — this one, and [id]/approve|complete|reopen below, which key off a taskId instead —
 *  to use the identical dynamic slug name; see the approve/complete/reopen routes' own comments
 *  for why those are a different id entirely despite sharing this segment name. */
export async function GET(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id: employeeId } = await ctx.params;
    const tasks = await listDateTasks(employee, employeeId);
    return NextResponse.json({ tasks });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/date-tasks/[id] — push a new task onto that employee's date. Admin or their
 *  supervisor only (createDateTask itself enforces this). Body: { taskDate, description }. */
export async function POST(request: Request, ctx: RouteContext<"/api/date-tasks/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id: employeeId } = await ctx.params;
    const body = await request.json();
    const task = await createDateTask(employee, employeeId, String(body.taskDate ?? ""), String(body.description ?? ""));
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
