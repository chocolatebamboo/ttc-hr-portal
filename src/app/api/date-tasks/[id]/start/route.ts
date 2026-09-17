import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { startDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[id]/start — the task's own employee marking it as started (ASSIGNED or
 *  RETURNED → IN_PROGRESS). `id` here is a taskId, not an employeeId — see the comment on
 *  /api/date-tasks/[id]/route.ts for why this segment shares its name with that unrelated route.
 *  New with correction brief #2's per-task lifecycle rework. */
export async function POST(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]/start">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const task = await startDateTask(employee, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
