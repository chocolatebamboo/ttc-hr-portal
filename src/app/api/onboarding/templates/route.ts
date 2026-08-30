import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listOnboardingTemplates, createOnboardingTemplate } from "@/lib/onboarding-templates";
import { InvalidOnboardingError } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/onboarding/templates — every reusable template, for the Manage Templates screen
 *  and the picker shown when starting a new checklist. HR/Super Admin only. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const templates = await listOnboardingTemplates(employee);
    return NextResponse.json({ templates });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/onboarding/templates — creates an empty template. Body: { name, description? }. */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const body = await request.json().catch(() => ({}));
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new InvalidOnboardingError("Give the template a name.");
    }
    const template = await createOnboardingTemplate(
      employee,
      body.name,
      typeof body.description === "string" ? body.description : undefined
    );
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
