import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listCertificationAttempts } from "@/lib/certification";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/items/[id]/certification/attempts — attempt history for one
 *  CERTIFICATION step, newest first. Self, or HR/the employee's own supervisor (same shared DTO
 *  either way — see listCertificationAttempts). */
export async function GET(_request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/certification/attempts">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const attempts = await listCertificationAttempts(employee, id);
    return NextResponse.json({ attempts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
