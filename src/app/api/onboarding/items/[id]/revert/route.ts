import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { revertOnboardingItem } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/items/[id]/revert — HR/Super Admin, or the employee's own supervisor
 *  (assertCanReviewOnboarding, enforced inside revertOnboardingItem). Only valid for a
 *  DOCUMENT/TRAINING/MEETING/CERTIFICATION step currently COMPLETED — sends it back to
 *  NOT_STARTED so the employee can go through it again. CB, Sept 2026: onboarding steps
 *  "shouldn't feel like it's final." */
export async function POST(_request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/revert">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    await revertOnboardingItem(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
