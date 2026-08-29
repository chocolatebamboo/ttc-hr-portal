import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { decideOnboardingItem } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/items/[id]/approve — HR/Super Admin, or the employee's own
 *  supervisor (assertCanReviewOnboarding, enforced inside decideOnboardingItem). Only valid
 *  for a step currently sitting in AWAITING_APPROVAL. */
export async function POST(_request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/approve">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    await decideOnboardingItem(employee, id, "APPROVE");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
