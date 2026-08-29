import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { startOnboarding } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/manage/[employeeId]/start — HR/Super Admin only. Creates the
 *  checklist, seeded with the standard starter items. */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/onboarding/manage/[employeeId]/start">
) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { employeeId } = await ctx.params;
    const onboarding = await startOnboarding(employee, employeeId);
    return NextResponse.json({ onboarding }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
