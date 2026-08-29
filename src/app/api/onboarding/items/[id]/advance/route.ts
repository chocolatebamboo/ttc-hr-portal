import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { advanceOnboardingItem } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/onboarding/items/[id]/advance — moves one step forward for the employee (or an
 * admin acting on their behalf): completes a TASK directly, or acknowledges+submits a
 * DOCUMENT/TRAINING/MEETING step for approval. No role check here on purpose — RLS decides
 * whether this caller may touch this specific item at all (their own checklist, or an admin),
 * and advanceOnboardingItem's own self-or-admin check decides whether they may act on it, the
 * same layered pattern document acknowledgment already relies on.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/advance">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    await advanceOnboardingItem(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
