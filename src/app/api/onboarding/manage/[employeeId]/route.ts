import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getOnboardingForManager } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/manage/[employeeId] — HR/Super Admin, or that employee's own
 *  supervisor (assertCanReviewOnboarding, enforced inside getOnboardingForManager). One
 *  employee's checklist, or { onboarding: null } if it hasn't been started. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/onboarding/manage/[employeeId]">
) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const onboarding = await getOnboardingForManager(employee, employeeId);
    return NextResponse.json({ onboarding });
  } catch (err) {
    return toErrorResponse(err);
  }
}
