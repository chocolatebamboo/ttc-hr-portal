import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { decideAvailability, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/decide — body { decision: "APPROVED" | "DENIED", comment? }
 * Reuses the same supervisor-of relationship as timesheet/PTO review
 * (assertCanReviewAvailability) — a supervisor's authority over their team is one
 * relationship, not a separate one per feature. Looks the submission up first (under the
 * reviewer's own RLS identity — see findAvailabilitySubmissionEmployeeId) to find which
 * employee it belongs to, since the route is now keyed by submission id, not employee id.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/availability/[submissionId]/decide">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (body.decision !== "APPROVED" && body.decision !== "DENIED") {
      throw new InvalidAvailabilityError('decision must be "APPROVED" or "DENIED".');
    }

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const decided = await decideAvailability(
      reviewer,
      submissionId,
      body.decision,
      typeof body.comment === "string" ? body.comment : undefined
    );
    return NextResponse.json(decided);
  } catch (err) {
    return toErrorResponse(err);
  }
}
