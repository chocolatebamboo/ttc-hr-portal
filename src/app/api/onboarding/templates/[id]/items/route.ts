import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { addOnboardingTemplateItem } from "@/lib/onboarding-templates";
import { InvalidOnboardingError } from "@/lib/onboarding";
import { toErrorResponse } from "@/lib/api-errors";
import type { OnboardingItemType } from "@/types";

const VALID_TYPES: OnboardingItemType[] = ["TASK", "DOCUMENT", "TRAINING", "MEETING"];

/** POST /api/onboarding/templates/[id]/items — adds one step to a template. Body:
 *  { label, itemType, description?, documentId?, dueOffsetDays? }. */
export async function POST(request: Request, ctx: RouteContext<"/api/onboarding/templates/[id]/items">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.label !== "string" || !body.label.trim()) {
      throw new InvalidOnboardingError("Step description is required.");
    }
    if (!VALID_TYPES.includes(body.itemType)) {
      throw new InvalidOnboardingError("Choose a valid step type.");
    }
    let dueOffsetDays: number | undefined;
    if (body.dueOffsetDays !== undefined && body.dueOffsetDays !== null && body.dueOffsetDays !== "") {
      const parsed = Number(body.dueOffsetDays);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new InvalidOnboardingError("Due date offset must be a non-negative number of days.");
      }
      dueOffsetDays = Math.round(parsed);
    }

    const item = await addOnboardingTemplateItem(employee, id, {
      label: body.label,
      description: typeof body.description === "string" ? body.description : undefined,
      itemType: body.itemType,
      documentId: typeof body.documentId === "string" && body.documentId ? body.documentId : undefined,
      dueOffsetDays,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
