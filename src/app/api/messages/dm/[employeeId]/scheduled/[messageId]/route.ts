import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { cancelScheduledMessage } from "@/lib/direct-messages";
import { toErrorResponse } from "@/lib/api-errors";

/** DELETE /api/messages/dm/[employeeId]/scheduled/[messageId] — "Schedule message" (Sept 2026,
 *  confirmed for deployment): cancels one of the caller's OWN still-pending scheduled messages.
 *  `[employeeId]` isn't used (same as the react/comment routes right next to this one) — a
 *  scheduled message's own senderId already determines who can cancel it; cancelScheduledMessage
 *  (src/lib/direct-messages.ts) re-checks that AND that it hasn't already gone out, and
 *  prisma/rls.sql's direct_message_delete backs up both halves independently. */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/messages/dm/[employeeId]/scheduled/[messageId]">
) {
  try {
    const employee = await requireEmployee();
    const { messageId } = await ctx.params;
    await cancelScheduledMessage(employee, messageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
