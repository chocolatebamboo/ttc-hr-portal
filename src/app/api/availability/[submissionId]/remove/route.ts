import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { removeAvailabilitySubmission, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/remove — Correction brief #10 (Sept 2026): the
 * administrative Remove/Delete action, distinct from POST .../decide's Deny — see
 * removeAvailabilitySubmission's own comment in src/lib/availability.ts for exactly how. Same
 * reviewer-lookup shape as POST .../decide and .../undecide: resolve which employee this
 * submission belongs to under the caller's own RLS identity, then check assertCanReviewAvailability
 * before acting, since the route is keyed by submission id rather than employee id.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/availability/[submissionId]/remove">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    await removeAvailabilitySubmission(reviewer, submissionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
