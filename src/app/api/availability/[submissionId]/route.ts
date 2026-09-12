import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { deleteAvailabilitySubmission } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/** DELETE /api/availability/[submissionId] — permanently remove one of the signed-in team
 *  member's own CANCELLED submissions (see deleteAvailabilitySubmission's doc comment for why
 *  it's limited to that status). Mirrors DELETE /api/pto/requests/[id] exactly. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/availability/[submissionId]">) {
  try {
    const employee = await requireEmployee();
    const { submissionId } = await ctx.params;
    await deleteAvailabilitySubmission(employee, submissionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
