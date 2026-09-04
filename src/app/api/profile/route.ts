import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getMyProfile, updateMyProfile } from "@/lib/profile";
import { toErrorResponse } from "@/lib/api-errors";
import type { UpdateMyProfileInput } from "@/types";

/** GET /api/profile — any signed-in employee, their own record only. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const profile = await getMyProfile(employee);
    return NextResponse.json({ profile });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** PATCH /api/profile — updates the caller's own contact info. See UpdateMyProfileInput
 *  (src/types/index.ts) for exactly which fields this accepts; anything else in the request
 *  body is ignored here and would be rejected by prisma/rls.sql's trigger even if it weren't. */
export async function PATCH(request: Request) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));

    const input: UpdateMyProfileInput = {
      preferredName: typeof body.preferredName === "string" ? body.preferredName : undefined,
      workPhone: typeof body.workPhone === "string" ? body.workPhone : undefined,
      personalPhone: typeof body.personalPhone === "string" ? body.personalPhone : undefined,
      personalEmail: typeof body.personalEmail === "string" ? body.personalEmail : undefined,
      emergencyContactName: typeof body.emergencyContactName === "string" ? body.emergencyContactName : undefined,
      emergencyContactPhone: typeof body.emergencyContactPhone === "string" ? body.emergencyContactPhone : undefined,
      emergencyContactRelation:
        typeof body.emergencyContactRelation === "string" ? body.emergencyContactRelation : undefined,
    };

    const profile = await updateMyProfile(employee, input);
    return NextResponse.json({ profile });
  } catch (err) {
    return toErrorResponse(err);
  }
}
