import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getDashboardNotificationsSummary } from "@/lib/dashboard-notifications";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/dashboard/notifications — Correction brief (Sept 2026, "Correction & Refinement
 * Brief" #1): "counts should update without requiring a manual page refresh." Backs the live
 * client-side poll in src/components/DashboardNotifications.tsx, same shape/interval
 * NotificationBell.tsx already polls /api/notifications with. The dashboard page itself calls
 * getDashboardNotificationsSummary directly (no HTTP round trip needed server-side) for the
 * first paint; this route is what the client re-checks afterwards.
 */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const summary = await getDashboardNotificationsSummary(employee);
    return NextResponse.json(summary);
  } catch (err) {
    return toErrorResponse(err);
  }
}
