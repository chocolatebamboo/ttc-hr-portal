import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { completeDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[taskId]/complete — the task's own employee marking it done. */
export async function POST(_request: Request, ctx: RouteContext<"/api/date-tasks/[taskId]/complete">) {
  try {
    const employee = await requireEmployee();
    const { taskId } = await ctx.params;
    const task = await completeDateTask(employee, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
