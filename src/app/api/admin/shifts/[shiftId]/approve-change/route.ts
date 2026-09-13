import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { approveShiftChange } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/admin/shifts/[shiftId]/approve-change — body { date?, startTime?, endTime?,
 * comment? }. Approves a pending CHANGE_REQUESTED — defaults to the team member's own proposed
 * date/time when given; passing date/startTime/endTime here lets the supervisor set (or
 * override) the final time instead. Authorization is assertCanManageShifts, checked inside
 * approveShiftChange itself.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/shifts/[shiftId]/approve-change">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    const dto = await approveShiftChange(employee, shiftId, {
      date: typeof body.date === "string" ? body.date : undefined,
      startTime: typeof body.startTime === "string" ? body.startTime : undefined,
      endTime: typeof body.endTime === "string" ? body.endTime : undefined,
      comment: typeof body.comment === "string" ? body.comment : undefined,
    });
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
