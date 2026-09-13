import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getClockInStatus } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/time/clock-in-status — Phase 3 (client spec, Sept 2026): the caller's own
 * before-the-click preview of what clocking in right now would do, so TimeClockCard can show a
 * "why are you clocking in early/late/with nothing scheduled?" reason field proactively instead
 * of only finding out after a rejected POST. Read-only and best-effort from the UI's side —
 * the real, authoritative check happens again inside applyClockAction at the moment of the
 * actual clock-in, since "right now" can move between the two calls.
 */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const status = await getClockInStatus(employee);
    return NextResponse.json(status);
  } catch (err) {
    return toErrorResponse(err);
  }
}
