import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { getOnboardingForAdmin } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/manage/[employeeId] — HR/Super Admin only. One employee's checklist,
 *  or { onboarding: null } if it hasn't been started. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/onboarding/manage/[employeeId]">
) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { employeeId } = await ctx.params;
    const onboarding = await getOnboardingForAdmin(employee, employeeId);
    return NextResponse.json({ onboarding });
  } catch (err) {
    return toErrorResponse(err);
  }
}
