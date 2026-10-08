import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getDateTaskSubmissionAttachmentUrl } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/[id]/submission-download — a short-lived signed URL for the file an
 *  employee attached AT submit time (submissionAttachmentKey), separate from the task's own
 *  original attachment (.../download, above). Same "resolve under the caller's own identity
 *  first, then sign" shape as that route. `id` here is a taskId, same segment-naming reasoning
 *  as every other route in this folder. */
export async function GET(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]/submission-download">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const url = await getDateTaskSubmissionAttachmentUrl(employee, taskId);
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
