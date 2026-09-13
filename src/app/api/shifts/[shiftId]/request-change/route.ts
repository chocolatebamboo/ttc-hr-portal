import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { requestShiftChange, InvalidShiftError } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/shifts/[shiftId]/request-change — the team member's own "Request Shift Change,"
 * body { reason, requestedDate?, requestedStartTime?, requestedEndTime? }. Ownership (is this
 * caller's OWN shift?) is checked inside requestShiftChange itself once it's looked the row up,
 * same "load first, then assert against what it actually belongs to" shape the admin shift
 * routes already use.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/shifts/[shiftId]/request-change">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new InvalidShiftError("Tell your supervisor why you need this shift changed.");
    }

    const dto = await requestShiftChange(employee, shiftId, {
      reason: body.reason,
      requestedDate: typeof body.requestedDate === "string" ? body.requestedDate : undefined,
      requestedStartTime: typeof body.requestedStartTime === "string" ? body.requestedStartTime : undefined,
      requestedEndTime: typeof body.requestedEndTime === "string" ? body.requestedEndTime : undefined,
    });
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
