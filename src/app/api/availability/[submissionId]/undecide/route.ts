import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { undecideAvailability, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

export async function POST(_request: Request, ctx: RouteContext<"/api/availability/[submissionId]/undecide">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const reopened = await undecideAvailability(reviewer, submissionId);
    return NextResponse.json(reopened);
  } catch (err) {
    return toErrorResponse(err);
  }
}
