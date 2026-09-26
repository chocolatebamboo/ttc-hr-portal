import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { decideAvailabilityDate, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

export async function POST(request: Request, ctx: RouteContext<"/api/availability/[submissionId]/decide-date">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.date !== "string" || !body.date) {
      throw new InvalidAvailabilityError("A date is required.");
    }
    if (body.decision !== "APPROVED" && body.decision !== "DENIED") {
      throw new InvalidAvailabilityError('decision must be "APPROVED" or "DENIED".');
    }

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const decided = await decideAvailabilityDate(
      reviewer,
      submissionId,
      body.date,
      body.decision,
      typeof body.comment === "string" ? body.comment : undefined
    );
    return NextResponse.json(decided);
  } catch (err) {
    return toErrorResponse(err);
  }
}
