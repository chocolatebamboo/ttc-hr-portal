import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { cancelShift, InvalidShiftError } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/shifts/[shiftId]/cancel — body { reason }. Authorization is
 *  assertCanManageShifts, checked inside cancelShift itself once it's looked the row up (the
 *  same "load first, then assert against what it actually belongs to" shape decideAvailability
 *  and its siblings use, since the route is keyed by shift id, not employee id). */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/shifts/[shiftId]/cancel">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new InvalidShiftError("A reason is required to cancel a shift.");
    }

    const dto = await cancelShift(employee, shiftId, body.reason);
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
