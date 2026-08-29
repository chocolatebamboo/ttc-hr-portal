import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getMyOnboarding } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding — the caller's own checklist, or { onboarding: null } if HR hasn't
 *  started one for them yet. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const onboarding = await getMyOnboarding(employee);
    return NextResponse.json({ onboarding });
  } catch (err) {
    return toErrorResponse(err);
  }
}
