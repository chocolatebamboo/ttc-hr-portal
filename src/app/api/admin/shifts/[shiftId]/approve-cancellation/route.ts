import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { approveShiftCancellation } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/shifts/[shiftId]/approve-cancellation — body { comment? }. Approves a pending
 *  CANCELLATION_REQUESTED, cancelling the shift outright. Authorization is assertCanManageShifts,
 *  checked inside approveShiftCancellation itself. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/shifts/[shiftId]/approve-cancellation">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    const dto = await approveShiftCancellation(employee, shiftId, typeof body.comment === "string" ? body.comment : undefined);
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
