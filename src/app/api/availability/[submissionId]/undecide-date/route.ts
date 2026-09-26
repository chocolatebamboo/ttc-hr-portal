import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { decideAvailabilityDate, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/decide-date — body { date, decision: "APPROVED" | "DENIED", comment? }
 * The per-date counterpart to /decide (which decides the whole submission at once) — see
 * decideAvailabilityDate's own doc comment in src/lib/availability.ts. This route was missing
 * entirely (confirmed against the live build's own printed route manifest, Sept 2026): every
 * "Approve this date"/"Deny this date" click on TeamAvailabilityCards' per-date panel was
 * hitting a 404, which the client's generic catch surfaced as "Unable to save that decision.
 * Please try again." with nothing logged server-side, since a 404 never reaches application
 * code — this is the real root cause of the repeated reports of that exact message, not a
 * Render free-tier cold start (its sibling /undecide-date, right below this one, was built
 * correctly the whole time and already worked). Same authorization shape as decide and
 * undecide-date: reused supervisor-of relationship (assertCanReviewAvailability), looked up
 * from the submission's own employeeId under the reviewer's RLS identity.
 */
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
