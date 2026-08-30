import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listCertificationQuestionsForAdmin } from "@/lib/certification";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/certification/questions — admin-only question bank view, answer key
 *  included. Powers the "Manage Certification Test" editor. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const questions = await listCertificationQuestionsForAdmin(employee);
    return NextResponse.json({ questions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
