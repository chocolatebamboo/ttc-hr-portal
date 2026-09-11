import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { approveDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[id]/approve — admin/supervisor confirming a completed task. `id` here
 *  is a taskId, not an employeeId — same segment name as the sibling GET/POST at
 *  /api/date-tasks/[id] only because Next.js requires one dynamic slug name per folder depth
 *  across every route beneath it; the two are unrelated ids that happen to share a name. */
export async function POST(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]/approve">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const task = await approveDateTask(employee, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
