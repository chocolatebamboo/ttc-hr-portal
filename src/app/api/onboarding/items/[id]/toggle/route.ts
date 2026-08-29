import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { toggleOnboardingItem } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/onboarding/items/[id]/toggle — flips one item between NOT_STARTED and COMPLETED.
 * No role check here on purpose: RLS decides whether this caller may touch this specific
 * item (their own checklist, or an admin), the same way document acknowledgment relies on
 * RLS rather than a role branch in the route.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/toggle">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const item = await toggleOnboardingItem(employee, id);
    return NextResponse.json({ item });
  } catch (err) {
    return toErrorResponse(err);
  }
}
