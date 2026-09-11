import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { reopenDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[id]/reopen — admin/supervisor sending a completed task back to
 *  PENDING instead of approving it. `id` here is a taskId, not an employeeId — see the comment
 *  on /api/date-tasks/[id]/route.ts for why this segment shares its name with that unrelated
 *  route. */
export async function POST(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]/reopen">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const task = await reopenDateTask(employee, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
