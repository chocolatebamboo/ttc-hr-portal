import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { updateCertificationQuestionKey } from "@/lib/certification";
import { toErrorResponse } from "@/lib/api-errors";

/** PATCH /api/onboarding/certification/questions/[id] — admin-only. Edits ONLY the answer-key
 *  fields of one question (correctOptionKeys, acceptedAnswers, requiredMatchCount, rubric) —
 *  question wording/type/order/points stay code-seeded. Body: any subset of those fields. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/onboarding/certification/questions/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    await updateCertificationQuestionKey(employee, id, {
      correctOptionKeys: Array.isArray(body.correctOptionKeys) ? body.correctOptionKeys : undefined,
      acceptedAnswers: Array.isArray(body.acceptedAnswers) ? body.acceptedAnswers : undefined,
      requiredMatchCount:
        body.requiredMatchCount === null || typeof body.requiredMatchCount === "number"
          ? body.requiredMatchCount
          : undefined,
      rubric: typeof body.rubric === "string" || body.rubric === null ? body.rubric : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
