import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { deleteAllNotifications } from "@/lib/notifications";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/notifications/clear-all — "Clear all" on the header bell dropdown. No body.
 *  Distinct from /api/notifications/read-all: this permanently removes every one of the signed-
 *  in employee's own notifications rather than just marking them read (see
 *  deleteAllNotifications' own doc comment in src/lib/notifications.ts). */
export async function POST() {
  try {
    const employee = await requireEmployee();
    await deleteAllNotifications(employee);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
