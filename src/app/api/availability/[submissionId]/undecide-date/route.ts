import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { undecideAvailabilityDate, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/undecide-date — body { date }. The per-date counterpart
 * to /undecide (which reopens the whole submission) — see undecideAvailabilityDate's own doc
 * comment in src/lib/availability.ts for why this exists separately: CB, Sept 2026, "even if
 * it's approved, I should still be able to make adjustments... it's not just final." Same
 * authorization shape as decide-date: reused supervisor-of relationship
 * (assertCanReviewAvailability), looked up from the submission's own employeeId under the
 * reviewer's RLS identity.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/availability/[submissionId]/undecide-date">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.date !== "string" || !body.date) {
      throw new InvalidAvailabilityError("A date is required.");
    }

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const reopened = await undecideAvailabilityDate(reviewer, submissionId, body.date);
    return NextResponse.json(reopened);
  } catch (err) {
    return toErrorResponse(err);
  }
}
