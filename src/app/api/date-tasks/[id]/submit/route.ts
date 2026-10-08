import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { submitDateTask, InvalidDateTaskError } from "@/lib/date-tasks";
import { uploadDateTaskFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/[id]/submit — the task's own employee sending it in for review
 *  (ASSIGNED/IN_PROGRESS/RETURNED → AWAITING_REVIEW). Replaces the old .../complete route —
 *  correction brief #2 renamed "complete" to "submit" now that a submitted task still needs an
 *  admin/supervisor's approval before it's actually done. `id` here is a taskId, not an
 *  employeeId — see the comment on /api/date-tasks/[id]/route.ts for why this segment shares its
 *  name with that unrelated route.
 *
 *  Oct 2026: now multipart instead of body-less — `note` and an optional `file`, same "note +
 *  optional one file" shape as the sibling POST /api/date-tasks/[id] (createDateTask). Both stay
 *  optional, so DateTaskRow's plain one-tap "mark complete" (nothing typed) still works exactly
 *  as before; the employeeId the file is keyed under comes from the task row itself
 *  (submitDateTask/loadOwnTaskRow already confirms this caller owns it), not a client-supplied
 *  value. */
export async function POST(request: Request, ctx: RouteContext<"/api/date-tasks/[id]/submit">) {
  try {
    const employee = await requireEmployee();
    const { id: taskId } = await ctx.params;

    const form = await request.formData();
    const note = String(form.get("note") ?? "");
    const file = form.get("file");

    if (file !== null && !(file instanceof File)) {
      throw new InvalidDateTaskError("That file couldn't be read — please try attaching it again.");
    }

    const attachment =
      file instanceof File && file.size > 0
        ? { key: await uploadDateTaskFile(file, employee.id), name: file.name }
        : undefined;

    const task = await submitDateTask(employee, taskId, note, attachment);
    return NextResponse.json({ task });
  } catch (err) {
    return toErrorResponse(err);
  }
}
