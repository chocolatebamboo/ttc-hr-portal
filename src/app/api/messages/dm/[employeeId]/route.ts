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
 *  (text, may be empty if a file is attached), an optional `file`, an optional `replyToId`
 *  (CB, Sept 2026: "I should be able to reply to a specific message within the message thread") —
 *  the id of an earlier message in this same thread to quote — and, as of Phase 5d, an optional
 *  `refType`/`refId`/`refDate` trio (CB: "chat icons on availability requests linked to specific
 *  dates") for a message started from a date's own "Message about this date" button. Only
 *  AVAILABILITY_DATE is accepted here — see postMessage's own doc comment in
 *  src/lib/direct-messages.ts for why DATE_TASK stays server-only. All three ref fields are
 *  required together or not sent at all; postMessage itself doesn't re-verify the caller can
 *  access that submissionId (the resulting message is still only ever readable by its own
 *  sender/recipient, same as any other DM), so a bogus id just fails to resolve a label rather
 *  than exposing anything. Same shape as POST /api/team-notes/[employeeId], minus the topic
 *  fields (a DM has no topic to scope to).
 *
 *  "Schedule message" (Sept 2026, confirmed for deployment): an optional `scheduledFor`, an ISO
 *  timestamp string built client-side from a plain `datetime-local` input (so this is always
 *  interpreted in whichever timezone the browser that sent it is in — there's no server-side
 *  timezone concept for this feature the way ORG_TIMEZONE is needed for shift reminders, since
 *  this is one person picking a time for their own message, not a company-wide shift clock).
 *  postMessage rejects anything not strictly in the future. */
export async function POST(request: Request, ctx: RouteContext<"/api/messages/dm/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;

    const form = await request.formData();
    const body = String(form.get("body") ?? "");
    const file = form.get("file");
    const replyToId = form.get("replyToId");
    const refType = form.get("refType");
    const refId = form.get("refId");
    const refDate = form.get("refDate");
    const scheduledForRaw = form.get("scheduledFor");

    if (file !== null && !(file instanceof File)) {
      throw new InvalidDirectMessageError("That file couldn't be read — please try attaching it again.");
    }
    if (replyToId !== null && typeof replyToId !== "string") {
      throw new InvalidDirectMessageError("That message can't be replied to.");
    }

    let ref: { type: "AVAILABILITY_DATE"; id: string; date: string | null } | undefined;
    if (refType !== null || refId !== null || refDate !== null) {
      if (refType !== "AVAILABILITY_DATE" || typeof refId !== "string" || !refId || typeof refDate !== "string" || !refDate) {
        throw new InvalidDirectMessageError("That reference can't be attached.");
      }
      ref = { type: "AVAILABILITY_DATE", id: refId, date: refDate };
    }

    let scheduledFor: Date | null = null;
    if (scheduledForRaw !== null) {
      if (typeof scheduledForRaw !== "string" || !scheduledForRaw) {
        throw new InvalidDirectMessageError("That scheduled time isn't valid.");
      }
      const parsed = new Date(scheduledForRaw);
      if (Number.isNaN(parsed.getTime())) {
        throw new InvalidDirectMessageError("That scheduled time isn't valid.");
      }
      scheduledFor = parsed;
    }

    const attachment =
      file instanceof File && file.size > 0
        ? { key: await uploadDirectMessageFile(file, employee.id, employeeId), name: file.name }
        : undefined;

    const message = await postMessage(employee, employeeId, body, attachment, ref, replyToId || null, scheduledFor);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
