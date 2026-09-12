import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { convertAvailabilityDateToShift, InvalidShiftError } from "@/lib/shifts";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/admin/availability/[submissionId]/convert-to-shift — body { date }. The actual
 * "Scheduling" step: turns ONE date out of an already-approved submission into a real confirmed
 * Shift. Authorization (is the caller this employee's supervisor, or admin?) is
 * assertCanManageShifts, checked inside convertAvailabilityDateToShift once it's resolved which
 * employee the submission belongs to.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/admin/availability/[submissionId]/convert-to-shift">
) {
  try {
    const employee = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.date !== "string" || !body.date) {
      throw new InvalidShiftError("Choose which date to schedule.");
    }

    const dto = await convertAvailabilityDateToShift(employee, submissionId, body.date);
    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
