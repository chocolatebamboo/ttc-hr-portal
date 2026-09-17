import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { submitDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[id]/submit — the task's own employee sending it in for review
 *  (ASSIGNED/IN_PROGRESS/RETURNED → AWAITING_REVIEW). Replaces the old .../complete route —
 *  correction brief #2 renamed "complete" to "submit" now that a submitted task still needs an
 *  admin/supervisor's approval before it's actually done. `id` here is a taskId, not an
 *  employeeId — see the comment on /api/date-tasks/[id]/route.ts for why this segment shares its
 *  name with that unrelated route. */
export async function POST(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]/submit">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const task = await submitDateTask(employee, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
