import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { reopenDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[taskId]/reopen — admin/supervisor sending a completed task back to
 *  PENDING instead of approving it. */
export async function POST(_request: Request, ctx: RouteContext<"/api/date-tasks/[taskId]/reopen">) {
  try {
    const employee = await requireEmployee();
    const { taskId } = await ctx.params;
    const task = await reopenDateTask(employee, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
