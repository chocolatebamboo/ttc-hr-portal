import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getDateTaskAttachmentUrl } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/[id]/download — a short-lived signed URL for a task's attachment. `id`
 *  here is a taskId, not an employeeId — same segment name as the sibling GET/POST at
 *  /api/date-tasks/[id] only because Next.js requires one dynamic slug name per folder depth
 *  across every route beneath it; the two are unrelated ids that happen to share a name. Same
 *  "resolve under the caller's own identity first, then sign, never redirect/stream directly"
 *  shape as /api/team-notes/[employeeId]/[noteId]/download. */
export async function GET(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]/download">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const url = await getDateTaskAttachmentUrl(employee, taskId);
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
