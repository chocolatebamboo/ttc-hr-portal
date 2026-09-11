import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listDateTasks, createDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/[employeeId] — that employee's tasks, self/supervisor/admin only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/date-tasks/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const tasks = await listDateTasks(employee, employeeId);
    return NextResponse.json({ tasks });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/date-tasks/[employeeId] — push a new task onto that employee's date. Admin or
 *  their supervisor only (createDateTask itself enforces this). Body: { taskDate, description }. */
export async function POST(request: Request, ctx: RouteContext<"/api/date-tasks/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const body = await request.json();
    const task = await createDateTask(employee, employeeId, String(body.taskDate ?? ""), String(body.description ?? ""));
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
