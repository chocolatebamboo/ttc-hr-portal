import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { addAvailabilityReviewComment, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

export async function POST(request: Request, ctx: RouteContext<"/api/availability/[submissionId]/comment">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.comment !== "string" || !body.comment.trim()) {
      throw new InvalidAvailabilityError("A note is required.");
    }

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const updated = await addAvailabilityReviewComment(reviewer, submissionId, body.comment);
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
