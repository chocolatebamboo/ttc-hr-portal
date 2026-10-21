import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getShiftLocation } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/shifts/[shiftId] — resolves just enough about one shift (which employee, which date)
 * for NotificationBell's click handler to deep-link a SHIFT_REQUEST_RECEIVED notification
 * straight to that employee's Review Timesheet page (/team/[employeeId]?week=date) instead of
 * the flat Team Schedule list — see getShiftLocation's own doc comment in src/lib/shifts.ts for
 * the full story (CB, Oct 2026: "that's not how it was before... remember, it was this view").
 * Deliberately not a general single-shift read endpoint (no times/status in the response) — add
 * fields here only once something else actually needs them. Same self-or-supervisor/admin access
 * rule GET /api/shifts?employeeId=... already enforces, via getShiftLocation's own
 * assertCanAccessEmployeeRecords check.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/shifts/[shiftId]">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const location = await getShiftLocation(employee, shiftId);
    return NextResponse.json(location);
  } catch (err) {
    return toErrorResponse(err);
  }
}
