import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getDateTaskCommentAttachmentUrl } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/[id]/comments/[commentId]/download — a short-lived signed URL for one
 *  comment's attachment. Same "resolve under the caller's own identity first, then sign, never
 *  redirect/stream directly" shape as /api/date-tasks/[id]/download and
 *  /api/team-notes/[employeeId]/[noteId]/download. `id` here is unused (the comment's own
 *  taskId is looked up via commentId, not this segment) but kept so this route lives alongside
 *  its sibling comments routes under the same taskId path instead of a bare top-level
 *  /api/date-task-comments/[commentId]/download. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/date-tasks/[id]/comments/[commentId]/download">
) {
  try {
    const employee = await requireEmployee();
    const { commentId } = await ctx.params;
    const url = await getDateTaskCommentAttachmentUrl(employee, commentId);
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
