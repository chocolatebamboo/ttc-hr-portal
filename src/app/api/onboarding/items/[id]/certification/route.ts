import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getCertificationQuestionsForTaking } from "@/lib/certification";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/items/[id]/certification — the sanitized question list (no answer key)
 *  for a CERTIFICATION step the employee is about to take. Self, or an admin previewing. */
export async function GET(_request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/certification">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const questions = await getCertificationQuestionsForTaking(employee, id);
    return NextResponse.json({ questions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
