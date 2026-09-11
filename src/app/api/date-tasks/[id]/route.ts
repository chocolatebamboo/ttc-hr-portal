import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listDateTasks, createDateTask, InvalidDateTaskError } from "@/lib/date-tasks";
import { uploadDateTaskFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/date-tasks/[id] — that employee's tasks, self/supervisor/admin only. Segment is
 *  named `id` (not `employeeId`) because Next.js requires every route sharing this folder
 *  depth — this one, and [id]/approve|complete|reopen below, which key off a taskId instead —
 *  to use the identical dynamic slug name; see the approve/complete/reopen routes' own comments
 *  for why those are a different id entirely despite sharing this segment name. */
export async function GET(_request: Request, ctx: RouteContext<"/api/date-tasks/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id: employeeId } = await ctx.params;
    const tasks = await listDateTasks(employee, employeeId);
    return NextResponse.json({ tasks });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/date-tasks/[id] — push a new task onto that employee's date. Admin or their
 *  supervisor only (createDateTask itself enforces this). Multipart: `taskDate`, `description`,
 *  and an optional `file` — same "body text + optional file" shape as team-notes' POST, CB,
 *  Sept 2026: "I should be able to choose file or add files into that as well." */
export async function POST(request: Request, ctx: RouteContext<"/api/date-tasks/[id]">) {
  try {
    const employee = await requireEmployee();
    const { id: employeeId } = await ctx.params;

    const form = await request.formData();
    const taskDate = String(form.get("taskDate") ?? "");
    const description = String(form.get("description") ?? "");
    const file = form.get("file");

    if (file !== null && !(file instanceof File)) {
      throw new InvalidDateTaskError("That file couldn't be read — please try attaching it again.");
    }

    const attachment =
      file instanceof File && file.size > 0
        ? { key: await uploadDateTaskFile(file, employeeId), name: file.name }
        : undefined;

    const task = await createDateTask(employee, employeeId, taskDate, description, attachment);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
