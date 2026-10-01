import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listCurrentlyClockedIn } from "@/lib/attendance-admin";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/team/clocked-in — "Clocked in now" (CB, Oct 2026: "were supposed to see the clock
 * running when the team clocks in, that is very important"). Admin or Supervisor only —
 * listCurrentlyClockedIn itself throws ForbiddenError (-> 403 via toErrorResponse) for anyone
 * else, same as /api/team/reports leaves the actual narrowing to the library function rather
 * than asserting a role here first. Polled client-side by ClockedInNowSection on an interval
 * (same two-tier "server-rendered initial, then poll for updates" shape DashboardNotifications
 * already uses) so a clock-in from another tab/device shows up without a manual page refresh.
 */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const rows = await listCurrentlyClockedIn(employee);
    return NextResponse.json({ rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
