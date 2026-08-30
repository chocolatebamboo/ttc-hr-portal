import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { getOnboardingTemplate, deleteOnboardingTemplate } from "@/lib/onboarding-templates";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/templates/[id] — one template with its full ordered step list. */
export async function GET(_request: Request, ctx: RouteContext<"/api/onboarding/templates/[id]">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const template = await getOnboardingTemplate(employee, id);
    return NextResponse.json({ template });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/onboarding/templates/[id] — removes the template (cascades to its steps). Never
 *  touches a checklist already started from it — see deleteOnboardingTemplate's doc comment. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/onboarding/templates/[id]">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    await deleteOnboardingTemplate(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
