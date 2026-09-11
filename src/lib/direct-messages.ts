import { withRlsContext } from "@/lib/db";
import { getSignedDownloadUrl } from "@/lib/storage";
import type { CurrentEmployee, DirectConversationSummaryDTO, DirectMessageDTO } from "@/types";

export class InvalidDirectMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDirectMessageError";
  }
}

export class DirectMessageNotFoundError extends Error {
  constructor(message = "That message couldn't be found.") {
    super(message);
    this.name = "DirectMessageNotFoundError";
  }
}

type NameFields = { firstName: string; lastName: string; preferredName: string | null };

function nameOf(p: NameFields): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

type MessageRow = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  attachmentKey: string | null;
  attachmentName: string | null;
  createdAt: Date;
  sender: NameFields;
};

function toDTO(row: MessageRow): DirectMessageDTO {
  return {
    id: row.id,
    senderId: row.senderId,
    senderName: nameOf(row.sender),
    recipientId: row.recipientId,
    body: row.body,
    hasAttachment: row.attachmentKey !== null,
    attachmentName: row.attachmentName,
    createdAt: row.createdAt.toISOString(),
    // Nothing can attach one yet — DirectMessage.refType/refId/refDate exist in the schema
    // (see its doc comment in prisma/schema.prisma) so this doesn't need a second migration
    // once the "attach a reference" UI ships as a follow-up.
    ref: null,
  };
}

/**
 * Every DM conversation the viewer is part of, one row per other person, folded down from the
 * raw message rows — mirrors aggregateTopicCounts' shape in team-notes.ts (total/fromOthers) so
 * the unified My Messages inbox can sort and badge a DM row exactly like a topic row. There's no
 * separate Conversation table to query (see DirectMessage's doc comment), so this always scans
 * every message the viewer has sent or received; fine at this company's size, same tradeoff
 * listTeamNoteTopicCounts already makes.
 */
export async function listConversationSummaries(actor: CurrentEmployee): Promise<DirectConversationSummaryDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.directMessage.findMany({
      where: { OR: [{ senderId: actor.id }, { recipientId: actor.id }] },
      orderBy: { createdAt: "asc" },
      select: {
        senderId: true,
        recipientId: true,
        body: true,
        createdAt: true,
        sender: { select: { firstName: true, lastName: true, preferredName: true } },
        recipient: { select: { firstName: true, lastName: true, preferredName: true } },
      },
    });

    const byCounterpart = new Map<string, DirectConversationSummaryDTO>();
    for (const row of rows) {
      const mine = row.senderId === actor.id;
      const otherId = mine ? row.recipientId : row.senderId;
      const otherPerson = mine ? row.recipient : row.sender;
      const entry = byCounterpart.get(otherId) ?? {
        employeeId: otherId,
        employeeName: nameOf(otherPerson),
        lastMessage: "",
        lastMessageAt: "",
        total: 0,
        fromOthers: 0,
      };
      entry.total += 1;
      if (!mine) entry.fromOthers += 1;
      // Rows arrive oldest-first, so the last one written here is always the most recent.
      entry.lastMessage = row.body;
      entry.lastMessageAt = row.createdAt.toISOString();
      byCounterpart.set(otherId, entry);
    }
    return [...byCounterpart.values()];
  });
}

/**
 * One DM thread with `otherEmployeeId`, oldest first, like a normal chat log — same convention
 * listTeamNotes uses. No assertCanAccessEmployeeRecords check here (unlike listTeamNotes): a DM
 * isn't about whose HR record this is, it's just "did I send or receive it," which the where
 * clause below already expresses and prisma/rls.sql's direct_message_select backs up
 * independently.
 */
export async function listMessages(actor: CurrentEmployee, otherEmployeeId: string): Promise<DirectMessageDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.directMessage.findMany({
      where: {
        OR: [
          { senderId: actor.id, recipientId: otherEmployeeId },
          { senderId: otherEmployeeId, recipientId: actor.id },
        ],
      },
      include: { sender: { select: { firstName: true, lastName: true, preferredName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDTO);
  });
}

/**
 * Sends one DM from `actor` to `recipientId`. At least a body or an attachment is required (same
 * "a blank message isn't a real post" rule postTeamNote uses), and you can't message yourself.
 * `recipientId` is checked against a real Employee row rather than trusted outright — RLS would
 * still stop a bogus id from ever being readable back, but failing fast here gives a real error
 * message instead of a silently orphaned row.
 */
export async function postMessage(
  actor: CurrentEmployee,
  recipientId: string,
  body: string,
  attachment?: { key: string; name: string }
): Promise<DirectMessageDTO> {
  if (recipientId === actor.id) {
    throw new InvalidDirectMessageError("You can't message yourself.");
  }
  const trimmedBody = body.trim();
  if (!trimmedBody && !attachment) {
    throw new InvalidDirectMessageError("Write a message or attach a file.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const recipient = await tx.employee.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!recipient) {
      throw new InvalidDirectMessageError("That person couldn't be found.");
    }

    const row = await tx.directMessage.create({
      data: {
        senderId: actor.id,
        recipientId,
        body: trimmedBody,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
      },
      include: { sender: { select: { firstName: true, lastName: true, preferredName: true } } },
    });
    return toDTO(row);
  });
}

/**
 * A short-lived signed URL for one DM's attachment. Re-checks access from scratch (both this
 * membership check AND the row read itself, which only succeeds under direct_message_select) —
 * same "resolve under the caller's own RLS identity, then sign" shape
 * getTeamNoteAttachmentUrl uses, rather than trusting a prior listMessages call.
 */
export async function getDirectMessageAttachmentUrl(actor: CurrentEmployee, messageId: string): Promise<string> {
  const row: { senderId: string; recipientId: string; attachmentKey: string | null } | null = await withRlsContext(
    { employeeId: actor.id, role: actor.role },
    async (tx) => {
      return tx.directMessage.findUnique({
        where: { id: messageId },
        select: { senderId: true, recipientId: true, attachmentKey: true },
      });
    }
  );

  if (!row || (row.senderId !== actor.id && row.recipientId !== actor.id) || !row.attachmentKey) {
    throw new DirectMessageNotFoundError();
  }

  return getSignedDownloadUrl(row.attachmentKey);
}
