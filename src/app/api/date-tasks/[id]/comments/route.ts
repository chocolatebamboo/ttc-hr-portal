import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listDateTaskComments, addDateTaskComment, InvalidDateTaskError } from "@/lib/date-tasks";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/[id]/comments — one task's comment thread, oldest first. Self, that
 *  task's employee's supervisor, or an admin only (listDateTaskComments itself enforces this).
 *  `id` here is a taskId, not an employeeId — see the comment on /api/date-tasks/[id]/route.ts
 *  for why this segment shares its name with that unrelated route. New with correction brief
 *  #2's task-scoped DateTaskComment, replacing the old standalone per-date TeamNote
 *  "Conversation" section. */
export async function GET(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]/comments">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;
    const comments = await listDateTaskComments(employee, taskId);
    return NextResponse.json({ comments });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/date-tasks/[id]/comments — post one comment on the task. Multipart: `body` (text,
 *  may be empty if a file is attached) and an optional `file` — same "body text + optional file"
 *  shape as team-notes' POST. Same access rule as GET. The raw file is handed straight to
 *  addDateTaskComment rather than uploaded here first — it needs the task's own subject
 *  employeeId as the storage key prefix (see that function's own comment), which this route
 *  layer doesn't know until it resolves the task. */
export async function POST(request: Request, ctx: RouteContext<"/api/date-tasks/[id]/comments">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;

    const form = await request.formData();
    const body = String(form.get("body") ?? "");
    const file = form.get("file");

    if (file !== null && !(file instanceof File)) {
      throw new InvalidDateTaskError("That file couldn't be read — please try attaching it again.");
    }

    const comment = await addDateTaskComment(employee, taskId, body, file instanceof File && file.size > 0 ? file : undefined);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
