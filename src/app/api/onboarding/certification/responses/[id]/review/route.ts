import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { reviewCertificationResponse, InvalidCertificationError } from "@/lib/certification";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/certification/responses/[id]/review — HR/admin, or the employee's own
 *  supervisor, grades one manual-review response. Body: { outcome: "MEETS" | "DOES_NOT_MEET",
 *  comment?: string }. The attempt auto-finalizes (PASSED/FAILED) the moment every manual-review
 *  response on it has been graded — see reviewCertificationResponse. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/onboarding/certification/responses/[id]/review">
) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    if (body.outcome !== "MEETS" && body.outcome !== "DOES_NOT_MEET") {
      throw new InvalidCertificationError('outcome must be "MEETS" or "DOES_NOT_MEET".');
    }
    await reviewCertificationResponse(employee, id, body.outcome, body.comment);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
