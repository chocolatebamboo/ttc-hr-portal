import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { dismissDecidedAvailability } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/admin/availability/[submissionId]/dismiss — Correction brief #9 (Sept 2026):
 * "persist dismissal state" for a Decided card an admin has swiped to clear from the HR
 * availability roster. Admin-only, same as the rest of /api/admin/availability — see
 * dismissDecidedAvailability's own comment in src/lib/availability.ts for how the dismissal key
 * is derived server-side rather than trusted from the client.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/availability/[submissionId]/dismiss">) {
  try {
    const employee = await requireEmployee();
    const { submissionId } = await ctx.params;
    await dismissDecidedAvailability(employee, submissionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
