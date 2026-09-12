import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { reassignShift, InvalidShiftError } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/shifts/[shiftId]/reassign — body { employeeId, reason? }. `employeeId` here
 *  is the NEW team member the shift is being handed to — the original shift's own employee is
 *  resolved from the row itself inside reassignShift, same "load first, assert against what it
 *  belongs to" shape the cancel route just above uses. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/shifts/[shiftId]/reassign">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.employeeId !== "string" || !body.employeeId) {
      throw new InvalidShiftError("Choose who this shift is being reassigned to.");
    }

    const dto = await reassignShift(employee, shiftId, body.employeeId, typeof body.reason === "string" ? body.reason : undefined);
    return NextResponse.json(dto);
  } catch (err) {
    return toErrorResponse(err);
  }
}
