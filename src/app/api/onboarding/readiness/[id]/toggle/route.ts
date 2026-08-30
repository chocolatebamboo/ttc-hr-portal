import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { toggleReadinessItem } from "@/lib/onboarding-readiness";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/readiness/[id]/toggle — flips one internal readiness task between
 *  done/not-done. HR/Super Admin, or that employee's own supervisor (assertCanReviewOnboarding,
 *  enforced inside toggleReadinessItem). No approval step — this is a plain checkbox. */
export async function POST(_request: Request, ctx: RouteContext<"/api/onboarding/readiness/[id]/toggle">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    await toggleReadinessItem(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
