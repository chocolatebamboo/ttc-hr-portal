import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { removeAvailabilityDate } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * DELETE /api/availability/[submissionId]/dates/[date] — a team member removing ONE date out
 * of one of their own Pending or Denied submissions, without touching the other dates in that
 * same batch. See removeAvailabilityDate's doc comment in src/lib/availability.ts for why this
 * exists alongside (not instead of) the whole-submission cancel route.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/availability/[submissionId]/dates/[date]">) {
  try {
    const employee = await requireEmployee();
    const { submissionId, date } = await ctx.params;
    const submission = await removeAvailabilityDate(employee, submissionId, date);
    return NextResponse.json(submission);
  } catch (err) {
    return toErrorResponse(err);
  }
}
