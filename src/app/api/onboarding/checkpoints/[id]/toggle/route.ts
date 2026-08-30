import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { toggleCheckpointComplete } from "@/lib/onboarding-checkpoints";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/checkpoints/[id]/toggle — flips one checkpoint between
 *  PENDING/COMPLETED. HR/Super Admin, or that employee's own supervisor
 *  (assertCanReviewOnboarding, enforced inside toggleCheckpointComplete). No approval step. */
export async function POST(_request: Request, ctx: RouteContext<"/api/onboarding/checkpoints/[id]/toggle">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    await toggleCheckpointComplete(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
