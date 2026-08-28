import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanReviewTimesheet } from "@/lib/authorization";
import { reviewTimeEntry } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";
import { withRlsContext } from "@/lib/db";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/time/entries/[id]/return">
) {
  try {
    const reviewer = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const comment: string | undefined = typeof body.comment === "string" ? body.comment : undefined;

    const target = await withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, (tx) =>
      tx.timeEntry.findUnique({ where: { id }, select: { employeeId: true } })
    );
    if (!target) {
      return NextResponse.json({ error: "Time entry not found." }, { status: 404 });
    }
    await assertCanReviewTimesheet(reviewer, target.employeeId);

    const entry = await reviewTimeEntry(reviewer, id, "RETURN", comment);
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
