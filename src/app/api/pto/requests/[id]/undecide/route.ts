import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewTimesheet } from "@/lib/authorization";
import { undecidePtoRequest } from "@/lib/pto-actions";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/pto/requests/[id]/undecide — no body. Same "unapprove" capability as
 * .../availability/[submissionId]/undecide, for PTO requests — puts an Approved or Denied
 * request back to Pending. Same authorization shape as .../decide.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/pto/requests/[id]/undecide">) {
  try {
    const reviewer = await requireEmployee();
    const { id } = await ctx.params;

    const target: { employeeId: string } | null = await withRlsContext(
      { employeeId: reviewer.id, role: reviewer.role },
      async (tx) => {
        return tx.ptoRequest.findUnique({ where: { id }, select: { employeeId: true } });
      }
    );
    if (!target) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    await assertCanReviewTimesheet(reviewer, target.employeeId);

    const reopened = await undecidePtoRequest(reviewer, id);
    return NextResponse.json({ request: reopened });
  } catch (err) {
    return toErrorResponse(err);
  }
}
