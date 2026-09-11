import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listMessages, postMessage, InvalidDirectMessageError } from "@/lib/direct-messages";
import { uploadDirectMessageFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/messages/dm/[employeeId] — the caller's DM thread with that one other employee.
 *  `[employeeId]` here is the OTHER person, never the caller — access is just "were you a
 *  participant," enforced in src/lib/direct-messages.ts and backed up by prisma/rls.sql's
 *  direct_message_select, not by anything about whose record employeeId is. */
export async function GET(_request: Request, ctx: RouteContext<"/api/messages/dm/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const messages = await listMessages(employee, employeeId);
    return NextResponse.json({ messages });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/messages/dm/[employeeId] — send one message to that employee. Multipart: `body`
 *  (text, may be empty if a file is attached) and an optional `file`. Same shape as
 *  POST /api/team-notes/[employeeId], minus the topic fields (a DM has no topic to scope to). */
export async function POST(request: Request, ctx: RouteContext<"/api/messages/dm/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;

    const form = await request.formData();
    const body = String(form.get("body") ?? "");
    const file = form.get("file");

    if (file !== null && !(file instanceof File)) {
      throw new InvalidDirectMessageError("That file couldn't be read — please try attaching it again.");
    }

    const attachment =
      file instanceof File && file.size > 0
        ? { key: await uploadDirectMessageFile(file, employee.id, employeeId), name: file.name }
        : undefined;

    const message = await postMessage(employee, employeeId, body, attachment);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
