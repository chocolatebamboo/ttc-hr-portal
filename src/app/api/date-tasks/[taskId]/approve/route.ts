import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { approveDateTask } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[taskId]/approve — admin/supervisor confirming a completed task. */
export async function POST(_request: Request, ctx: RouteContext<"/api/date-tasks/[taskId]/approve">) {
  try {
    const employee = await requireEmployee();
    const { taskId } = await ctx.params;
    const task = await approveDateTask(employee, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
