import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listOnboardingForAdmin } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/manage — HR/Super Admin only. Every active employee, with checklist
 *  progress if one has been started. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const roster = await listOnboardingForAdmin(employee);
    return NextResponse.json({ roster });
  } catch (err) {
    return toErrorResponse(err);
  }
}
