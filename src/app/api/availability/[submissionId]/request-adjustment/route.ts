import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import {
  requestAvailabilityAdjustment,
  findAvailabilitySubmissionEmployeeId,
  InvalidAvailabilityError,
} from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/request-adjustment — body { adjustedSlots, comment? }.
 * The reviewer's third option besides /decide's Approve/Deny — "Adjust the proposed time and
 * send it to the team member for confirmation." Same authorization shape as /decide: looks the
 * submission up first (under the reviewer's own RLS identity) to find which employee it belongs
 * to, since the route is keyed by submission id, not employee id.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/availability/[submissionId]/request-adjustment">) {
  try {
    const reviewer = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (!Array.isArray(body.adjustedSlots)) {
      throw new InvalidAvailabilityError("Provide the adjusted times for each date.");
    }

    const employeeId = await findAvailabilitySubmissionEmployeeId(reviewer, submissionId);
    if (!employeeId) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    await assertCanReviewAvailability(reviewer, employeeId);

    const updated = await requestAvailabilityAdjustment(
      reviewer,
      submissionId,
      body.adjustedSlots,
      typeof body.comment === "string" ? body.comment : undefined
    );
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
