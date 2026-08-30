import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { startOnboarding } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/manage/[employeeId]/start — HR/Super Admin only. Body: { templateId? }.
 *  Creates the checklist, seeded either from a named template or (no templateId) the standard
 *  starter items. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/onboarding/manage/[employeeId]/start">
) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { employeeId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const templateId = typeof body.templateId === "string" && body.templateId ? body.templateId : undefined;
    const onboarding = await startOnboarding(employee, employeeId, templateId);
    return NextResponse.json({ onboarding }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
