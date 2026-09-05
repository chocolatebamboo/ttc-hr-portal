import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewAvailability } from "@/lib/authorization";
import { decideAvailability, InvalidAvailabilityError } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[employeeId]/decide — body { decision: "APPROVED" | "DENIED", comment? }
 * Reuses the same supervisor-of relationship as timesheet/PTO review
 * (assertCanReviewAvailability) — a supervisor's authority over their team is one
 * relationship, not a separate one per feature.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/availability/[employeeId]/decide">) {
  try {
    const reviewer = await requireEmployee();
    const { employeeId } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (body.decision !== "APPROVED" && body.decision !== "DENIED") {
      throw new InvalidAvailabilityError('decision must be "APPROVED" or "DENIED".');
    }

    await assertCanReviewAvailability(reviewer, employeeId);

    const decided = await decideAvailability(
      reviewer,
      employeeId,
      body.decision,
      typeof body.comment === "string" ? body.comment : undefined
    );
    return NextResponse.json(decided);
  } catch (err) {
    return toErrorResponse(err);
  }
}
