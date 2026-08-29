import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { listOnboardingForManager } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/manage — HR/Super Admin, or a supervisor. Every active employee the
 *  caller may manage (everyone for an admin, direct reports only for a supervisor), with
 *  checklist progress if one has been started. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    if (!isAdmin(employee) && employee.role !== "SUPERVISOR") throw new ForbiddenError();
    const roster = await listOnboardingForManager(employee);
    return NextResponse.json({ roster });
  } catch (err) {
    return toErrorResponse(err);
  }
}
