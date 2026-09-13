import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { requestShiftCancellation, InvalidShiftError } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/shifts/[shiftId]/request-cancellation — the team member's own "Request
 * Cancellation," body { reason }. Same ownership-checked-inside-the-lib-function shape as
 * request-change right next to this route.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/shifts/[shiftId]/request-cancellation">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new InvalidShiftError("Tell your supervisor why you need this shift cancelled.");
    }

    const dto = await requestShiftCancellation(employee, shiftId, body.reason);
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
