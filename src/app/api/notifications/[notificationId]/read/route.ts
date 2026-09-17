import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { markNotificationRead } from "@/lib/notifications";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/notifications/[notificationId]/read — marks one of the signed-in employee's own
 *  notifications read. No body. Silently a no-op if the id doesn't exist or isn't theirs (see
 *  markNotificationRead's own doc comment) — always returns 200 either way. */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/notifications/[notificationId]/read">
) {
  try {
    const employee = await requireEmployee();
    const { notificationId } = await ctx.params;
    await markNotificationRead(employee, notificationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
