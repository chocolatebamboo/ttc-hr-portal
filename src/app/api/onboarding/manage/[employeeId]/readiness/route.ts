import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listReadinessItems } from "@/lib/onboarding-readiness";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/manage/[employeeId]/readiness — HR/Super Admin, or that employee's own
 *  supervisor (assertCanReviewOnboarding, enforced inside listReadinessItems). Never reachable
 *  by the employee themselves — see prisma/rls.sql's onboarding_readiness_select. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/onboarding/manage/[employeeId]/readiness">
) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const items = await listReadinessItems(employee, employeeId);
    return NextResponse.json({ items });
  } catch (err) {
    return toErrorResponse(err);
  }
}
