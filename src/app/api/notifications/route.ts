import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listMyNotifications, countUnreadNotifications } from "@/lib/notifications";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/notifications — Phase 4 (client spec, Sept 2026): "a real in-app notification feed."
 * Backs the header bell — the signed-in employee's own most-recent 50 notifications plus a
 * standalone unread count, fetched together in one round trip since the bell needs both the
 * badge number and the dropdown list at once. Same "load both, return one object" shape
 * getClockInStatus/time-clock-status endpoints already use.
 */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const [notifications, unreadCount] = await Promise.all([
      listMyNotifications(employee),
      countUnreadNotifications(employee),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (err) {
    return toErrorResponse(err);
  }
}
