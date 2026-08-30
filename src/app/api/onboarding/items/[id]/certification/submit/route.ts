import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { submitCertificationAttempt } from "@/lib/certification";
import { toErrorResponse } from "@/lib/api-errors";
import type { CertificationAnswerInput } from "@/types";

/** POST /api/onboarding/items/[id]/certification/submit — the employee submits their full set
 *  of answers in one action. Auto-scores what it can immediately and moves the step to
 *  AWAITING_APPROVAL, same as DOCUMENT/TRAINING/MEETING. Body: { answers: CertificationAnswerInput[] }. */
export async function POST(request: Request, ctx: RouteContext<"/api/onboarding/items/[id]/certification/submit">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const answers: CertificationAnswerInput[] = Array.isArray(body.answers) ? body.answers : [];
    const result = await submitCertificationAttempt(employee, id, answers);
    return NextResponse.json({ ok: true, attemptId: result.attemptId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
