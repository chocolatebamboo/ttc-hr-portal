import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewTimesheet } from "@/lib/authorization";
import { decidePtoRequest, InvalidPtoRequestError } from "@/lib/pto-actions";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/pto/requests/[id]/decide — body { decision: "APPROVED" | "DENIED", comment? }
 * Reuses the same supervisor-of relationship as timesheet review (assertCanReviewTimesheet)
 * — a supervisor's authority over their team's PTO and timesheets is the same relationship,
 * not two things to keep in sync separately.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/pto/requests/[id]/decide">) {
  try {
    const reviewer = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (body.decision !== "APPROVED" && body.decision !== "DENIED") {
      throw new InvalidPtoRequestError('decision must be "APPROVED" or "DENIED".');
    }

    const target = await withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, (tx) =>
      tx.ptoRequest.findUnique({ where: { id }, select: { employeeId: true } })
    );
    if (!target) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    await assertCanReviewTimesheet(reviewer, target.employeeId);

    const decided = await decidePtoRequest(
      reviewer,
      id,
      body.decision,
      typeof body.comment === "string" ? body.comment : undefined
    );
    return NextResponse.json({ request: decided });
  } catch (err) {
    return toErrorResponse(err);
  }
}
