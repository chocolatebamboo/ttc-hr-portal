import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { dismissDashboardNotification } from "@/lib/dashboard-notifications";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/dashboard/notifications/dismiss — Correction brief #1/#9: "a deliberately dismissed
 * notification must remain dismissed... do not display a 'Show Again.'" Body: `{ banner:
 * "approvals" | "messages" }`. Never takes a count from the client — see
 * dismissDashboardNotification's own comment in src/lib/dashboard-notifications.ts for why the
 * current count is always recomputed server-side before building the dismissal key.
 */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));
    const banner = body?.banner;
    if (banner !== "approvals" && banner !== "messages") {
      return NextResponse.json({ error: "Unrecognized notification." }, { status: 400 });
    }
    const summary = await dismissDashboardNotification(employee, banner);
    return NextResponse.json(summary);
  } catch (err) {
    return toErrorResponse(err);
  }
}
