import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { respondToAvailabilityAdjustment, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/respond-adjustment — the team member's own response to
 * a pending ADJUSTMENT_REQUESTED, body { accept: boolean }. Ownership is checked inside
 * respondToAvailabilityAdjustment itself — this is the submission's own employee responding to a
 * proposal made about them, not a supervisor/HR action, so there's no assertCanReview* call here.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/availability/[submissionId]/respond-adjustment">) {
  try {
    const employee = await requireEmployee();
    const { submissionId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.accept !== "boolean") {
      throw new InvalidAvailabilityError("accept must be true or false.");
    }

    const updated = await respondToAvailabilityAdjustment(employee, submissionId, body.accept);
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
