import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { addOnboardingItem, InvalidOnboardingError } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/onboarding/manage/[employeeId]/items — HR/Super Admin only. Body:
 * { onboardingId, label, dueDate? }. employeeId in the URL is for routing/consistency with
 * the rest of this resource; the onboarding row itself is looked up by onboardingId.
 */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const body = await request.json().catch(() => ({}));

    if (typeof body.onboardingId !== "string" || !body.onboardingId) {
      throw new InvalidOnboardingError("Missing onboarding checklist.");
    }
    if (typeof body.label !== "string" || !body.label.trim()) {
      throw new InvalidOnboardingError("Item description is required.");
    }

    const dueDate = typeof body.dueDate === "string" && body.dueDate ? new Date(body.dueDate) : undefined;
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      throw new InvalidOnboardingError("Choose a valid due date.");
    }

    const item = await addOnboardingItem(employee, body.onboardingId, { label: body.label, dueDate });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
