import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { denyShiftRequest } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/shifts/[shiftId]/deny-request — body { comment? }. Declines a pending
 *  CHANGE_REQUESTED/CANCELLATION_REQUESTED, reverting the shift to UPCOMING. Authorization is
 *  assertCanManageShifts, checked inside denyShiftRequest itself. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/shifts/[shiftId]/deny-request">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    const dto = await denyShiftRequest(employee, shiftId, typeof body.comment === "string" ? body.comment : undefined);
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
