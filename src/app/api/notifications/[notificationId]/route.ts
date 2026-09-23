import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { deleteNotification } from "@/lib/notifications";
import { toErrorResponse } from "@/lib/api-errors";

/** DELETE /api/notifications/[notificationId] — Phase 5a: swipe-left-to-clear on the header
 *  bell's dropdown. Permanently removes one of the signed-in employee's own notifications (see
 *  deleteNotification's own doc comment) — silently a no-op if the id doesn't exist or isn't
 *  theirs, always returns 200 either way. */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/notifications/[notificationId]">
) {
  try {
    const employee = await requireEmployee();
    const { notificationId } = await ctx.params;
    await deleteNotification(employee, notificationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
