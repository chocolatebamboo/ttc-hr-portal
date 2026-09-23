import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listMessages, postMessage, InvalidDirectMessageError } from "@/lib/direct-messages";
import { uploadDirectMessageFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/messages/dm/[employeeId] — the caller's DM thread with that one other employee.
 *  `[employeeId]` here is the OTHER person, never the caller — access is just "were you a
 *  participant," enforced in src/lib/direct-messages.ts and backed up by prisma/rls.sql's
 *  direct_message_select, not by anything about whose record employeeId is. Response now also
 *  carries `otherLastReadAt` (CB, Sept 2026: "I should be able to see also when they read the
 *  message on their side") — see DirectMessageThreadDTO's own doc comment in src/types/index.ts. */
export async function GET(_request: Request, ctx: RouteContext<"/api/messages/dm/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const thread = await listMessages(employee, employeeId);
    return NextResponse.json(thread);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/messages/dm/[employeeId] — send one message to that employee. Multipart: `body`
 *  (text, may be empty if a file is attached), an optional `file`, and an optional `replyToId`
 *  (CB, Sept 2026: "I should be able to reply to a specific message within the message thread") —
 *  the id of an earlier message in this same thread to quote. Same shape as
 *  POST /api/team-notes/[employeeId], minus the topic fields (a DM has no topic to scope to). */
export async function POST(request: Request, ctx: RouteContext<"/api/messages/dm/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;

    const form = await request.formData();
    const body = String(form.get("body") ?? "");
    const file = form.get("file");
    const replyToId = form.get("replyToId");

    if (file !== null && !(file instanceof File)) {
      throw new InvalidDirectMessageError("That file couldn't be read — please try attaching it again.");
    }
    if (replyToId !== null && typeof replyToId !== "string") {
      throw new InvalidDirectMessageError("That message can't be replied to.");
    }

    const attachment =
      file instanceof File && file.size > 0
        ? { key: await uploadDirectMessageFile(file, employee.id, employeeId), name: file.name }
        : undefined;

    const message = await postMessage(employee, employeeId, body, attachment, undefined, replyToId || null);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
