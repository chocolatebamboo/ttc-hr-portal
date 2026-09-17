import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { returnDateTask, InvalidDateTaskError } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[id]/return — admin/supervisor sending a submitted task back with a
 *  required note instead of approving it. Replaces the old .../reopen route, which took no body
 *  and no note — correction brief #2: "Return/Reopen with a note." Body: { note }, mirroring
 *  /api/onboarding/items/[id]/return's own { reason } shape. `id` here is a taskId, not an
 *  employeeId — see the comment on /api/date-tasks/[id]/route.ts for why this segment shares its
 *  name with that unrelated route. */
export async function POST(request: Request, ctx: RouteContext<"/api/date-tasks/[id]/return">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note : "";
    if (!note.trim()) throw new InvalidDateTaskError("Add a note explaining what needs to change.");

    const task = await returnDateTask(employee, taskId, note);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
