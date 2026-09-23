import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { addComment, InvalidDirectMessageError } from "@/lib/direct-messages";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/messages/dm/[employeeId]/[messageId]/comment — Phase 5c, CB Sept 2026: "an option
 *  to add an internal comment," confirmed scope "hidden from the team member." Body: `{ body }`.
 *  Staff only — addComment itself throws ForbiddenError for a plain EMPLOYEE-role caller, and
 *  direct_message_comment_insert (prisma/rls.sql) backs that up independently at the database
 *  level. `[employeeId]` isn't used (same as the react/download routes alongside this one): a
 *  message's own senderId/recipientId already determine thread membership, this just keeps the
 *  URL shape consistent with its siblings. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/messages/dm/[employeeId]/[messageId]/comment">
) {
  try {
    const employee = await requireEmployee();
    const { messageId } = await ctx.params;

    const payload = await request.json().catch(() => ({}));
    const body = payload?.body;
    if (typeof body !== "string" || !body.trim()) {
      throw new InvalidDirectMessageError("Write something for the note.");
    }

    const comments = await addComment(employee, messageId, body);
    return NextResponse.json({ comments });
  } catch (err) {
    return toErrorResponse(err);
  }
}
