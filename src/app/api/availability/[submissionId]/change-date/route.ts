import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { changeAvailabilityDate, findAvailabilitySubmissionEmployeeId, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/change-date — body { date, newDate, newStartTime,
 * newEndTime, comment? }. CB, Sept 2026: "once we set it, then that becomes the new schedule...
 * it just updates on team member's end" — the reviewer sets a new date and/or time for one
 * still-Pending date and it's approved immediately, no team-member confirmation step (see
 * changeAvailabilityDate's own doc comment in src/lib/availability.ts for how this replaces the
 * old propose/respond-adjustment flow). Same authorization shape as /decide-date: reused
 * supervisor-of relationship (assertCanReviewAvailability), looked up from the submission's own
 * employeeId under the reviewer's RLS identity.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/availability/[submissionId]/change-date">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.date !== "string" || !body.date) {
      throw new InvalidAvailabilityError("A date is required.");
    }
    if (typeof body.newDate !== "string" || !body.newDate) {
      throw new InvalidAvailabilityError("A new date is required.");
    }
    if (typeof body.newStartTime !== "string" || !body.newStartTime) {
      throw new InvalidAvailabilityError("A new start time is required.");
    }
    if (typeof body.newEndTime !== "string" || !body.newEndTime) {
      throw new InvalidAvailabilityError("A new end time is required.");
    }

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const changed = await changeAvailabilityDate(
      reviewer,
      submissionId,
      body.date,
      { date: body.newDate, startTime: body.newStartTime, endTime: body.newEndTime },
      typeof body.comment === "string" ? body.comment : undefined
    );
    return NextResponse.json(changed);
  } catch (err) {
    return toErrorResponse(err);
  }
}
