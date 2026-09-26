import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { getAvailabilitySubmissionForReview, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/availability/[submissionId] — one submission, full detail (status, slots,
 * per-date decisions, reviewer names) — same DTO shape /api/admin/availability's list already
 * returns per row, just for one id instead of the whole Pending/Decided roster. Added (CB, Sept
 * 2026) to back the clickable reference chip on a "Loop in an admin" message in
 * DirectMessageThread.tsx — see getAvailabilitySubmissionForReview's own doc comment in
 * src/lib/availability.ts for why this reuses the same reviewer-only authorization every other
 * per-submission action here already requires, rather than granting broader visibility just
 * because the caller can see a message referencing it.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/availability/[submissionId]">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("That request could no longer be found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const submission = await getAvailabilitySubmissionForReview(reviewer, submissionId);
    if (!submission) {
      throw new InvalidAvailabilityError("That request could no longer be found.");
    }
    return NextResponse.json(submission);
  } catch (err) {
    return toErrorResponse(err);
  }
}
