import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listCheckpoints } from "@/lib/onboarding-checkpoints";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/manage/[employeeId]/checkpoints — HR/Super Admin, or that employee's own
 *  supervisor (assertCanReviewOnboarding, enforced inside listCheckpoints). Never reachable by
 *  the employee themselves — see prisma/rls.sql's onboarding_checkpoint_select. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/onboarding/manage/[employeeId]/checkpoints">
) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const checkpoints = await listCheckpoints(employee, employeeId);
    return NextResponse.json({ checkpoints });
  } catch (err) {
    return toErrorResponse(err);
  }
}
