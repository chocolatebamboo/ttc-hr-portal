import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import {
  removeAvailabilityDateForReview,
  findAvailabilitySubmissionEmployeeId,
  InvalidAvailabilityError,
} from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * DELETE /api/admin/availability/[submissionId]/dates/[date] — an admin/supervisor removing ONE
 * date out of a team member's Pending or Denied request, tucked behind the Edit/Done toggle on
 * TeamAvailabilityCards (CB, Sept 2026). Reviewer-side counterpart to
 * /api/availability/[submissionId]/dates/[date], which is employee-only and own-submission-only
 * — see removeAvailabilityDateForReview's own doc comment in src/lib/availability.ts.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/admin/availability/[submissionId]/dates/[date]">
) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId, date } = await ctx.params;

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const submission = await removeAvailabilityDateForReview(reviewer, submissionId, date);
    return NextResponse.json(submission);
  } catch (err) {
    return toErrorResponse(err);
  }
}
