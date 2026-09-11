import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getDirectMessageAttachmentUrl } from "@/lib/direct-messages";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/messages/dm/[employeeId]/[messageId]/download — a short-lived signed URL, same
 *  "resolve under the caller's own identity first, then sign" shape as the team-notes download
 *  route. `[employeeId]` isn't actually used (a message's own senderId/recipientId already
 *  determine access) but keeps the URL shape consistent with the rest of /api/messages/dm. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/messages/dm/[employeeId]/[messageId]/download">
) {
  try {
    const employee = await requireEmployee();
    const { messageId } = await ctx.params;
    const url = await getDirectMessageAttachmentUrl(employee, messageId);
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
