import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { markAllNotificationsRead } from "@/lib/notifications";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/notifications/read-all — "Clear all" on the header bell dropdown. No body. */
export async function POST() {
  try {
    const employee = await requireEmployee();
    await markAllNotificationsRead(employee);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
