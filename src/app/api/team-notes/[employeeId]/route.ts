import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listTeamNotes, postTeamNote, InvalidTeamNoteError } from "@/lib/team-notes";
import { uploadTeamNoteFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/team-notes/[employeeId] — the whole thread. Self, that employee's supervisor, or
 *  an admin only (listTeamNotes itself enforces this via assertCanAccessEmployeeRecords). */
export async function GET(_request: Request, ctx: RouteContext<"/api/team-notes/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const notes = await listTeamNotes(employee, employeeId);
    return NextResponse.json({ notes });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/team-notes/[employeeId] — post one message. Multipart: `body` (text, may be
 * empty if a file is attached) and an optional `file`. Same access rule as GET.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/team-notes/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;

    const form = await request.formData();
    const body = String(form.get("body") ?? "");
    const file = form.get("file");

    if (file !== null && !(file instanceof File)) {
      throw new InvalidTeamNoteError("That file couldn't be read — please try attaching it again.");
    }

    const attachment =
      file instanceof File && file.size > 0
        ? { key: await uploadTeamNoteFile(file, employeeId), name: file.name }
        : undefined;

    const note = await postTeamNote(employee, employeeId, body, attachment);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
