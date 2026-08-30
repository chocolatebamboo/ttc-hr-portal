import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { updateCheckpoint } from "@/lib/onboarding-checkpoints";
import { toErrorResponse } from "@/lib/api-errors";

/** PATCH /api/onboarding/checkpoints/[id] — HR/Super Admin, or that employee's own supervisor.
 *  Body: any of { notes, followUpNeeded, trainingMilestones, developmentGoals }; only the
 *  fields present are updated (see updateCheckpoint). A plain field edit, not a status change —
 *  see POST .../toggle for marking the checkpoint itself done. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/onboarding/checkpoints/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    await updateCheckpoint(employee, id, {
      notes: typeof body.notes === "string" ? body.notes : undefined,
      followUpNeeded: typeof body.followUpNeeded === "boolean" ? body.followUpNeeded : undefined,
      trainingMilestones: typeof body.trainingMilestones === "string" ? body.trainingMilestones : undefined,
      developmentGoals: typeof body.developmentGoals === "string" ? body.developmentGoals : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
