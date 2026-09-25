import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewTimesheet } from "@/lib/authorization";
import { addPtoReviewComment, InvalidPtoRequestError } from "@/lib/pto-actions";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";

export async function POST(request: Request, ctx: RouteContext<"/api/pto/requests/[id]/comment">) {
  try {
    const reviewer = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.comment !== "string" || !body.comment.trim()) {
      throw new InvalidPtoRequestError("A note is required.");
    }

    const target = await withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, (tx) =>
      tx.ptoRequest.findUnique({ where: { id }, select: { employeeId: true } })
    );
    if (!target) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    await assertCanReviewTimesheet(reviewer, target.employeeId);

    const updated = await addPtoReviewComment(reviewer, id, body.comment);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
