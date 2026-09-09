import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getTeamNoteAttachmentUrl } from "@/lib/team-notes";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/team-notes/[employeeId]/[noteId]/download — returns a short-lived signed URL,
 * same "resolve under the caller's own identity first, then sign, never redirect/stream
 * directly" shape as /api/documents/[id]/download.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/team-notes/[employeeId]/[noteId]/download">
) {
  try {
    const employee = await requireEmployee();
    const { employeeId, noteId } = await ctx.params;
    const url = await getTeamNoteAttachmentUrl(employee, employeeId, noteId);
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
