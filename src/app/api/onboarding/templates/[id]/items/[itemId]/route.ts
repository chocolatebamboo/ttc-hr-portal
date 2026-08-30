import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { removeOnboardingTemplateItem } from "@/lib/onboarding-templates";
import { toErrorResponse } from "@/lib/api-errors";

/** DELETE /api/onboarding/templates/[id]/items/[itemId] — removes one step from a template. */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/onboarding/templates/[id]/items/[itemId]">
) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id, itemId } = await ctx.params;
    await removeOnboardingTemplateItem(employee, id, itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
