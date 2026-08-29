import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { decideOnboardingItem, MissingReturnReasonError } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/onboarding/items/[id]/return — HR/Super Admin, or the employee's own supervisor.
 *  Body: { reason }. Sends a step back to the employee with a required explanation, mirroring
 *  how a returned timesheet day already works. */
export async function POST(request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/return">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!reason.trim()) throw new MissingReturnReasonError();

    await decideOnboardingItem(employee, id, "RETURN", reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
