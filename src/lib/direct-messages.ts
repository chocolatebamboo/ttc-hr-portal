import { withRlsContext } from "@/lib/db";
import { getSignedDownloadUrl } from "@/lib/storage";
import { threadKeyForDirectMessage, markThreadRead, getLastReadMap, isUnread } from "@/lib/message-read-state";
import type {
  CurrentEmployee,
  DirectConversationSummaryDTO,
  DirectMessageDTO,
  DirectMessageRefDTO,
  DirectMessageRefType,
} from "@/types";

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
  refType: string | null;
  refId: string | null;
  refDate: string | null;
};

/** Turns a raw ref{Type,Id,Date} triple into the labeled DTO shape the client actually renders
 *  — the reference card CB asked for ("I should be able to kind of like reference within the
 *  conversation of my message with a specific team member"), first wired up for DATE_TASK:
 *  every comment posted on a task now mirrors here (see addDateTaskComment's own doc comment in
 *  src/lib/date-tasks.ts) so the conversation it came from is one tap away from the DM it shows
 *  up in. `labels` is a pre-resolved id->label map (see resolveRefLabels below) — keeping the
 *  actual lookup out of this function means toDTO stays a plain sync mapper, same as before. */
function toDTO(row: MessageRow, labels: Map<string, string>): DirectMessageDTO {
  let ref: DirectMessageRefDTO | null = null;
  if (row.refType && row.refId) {
    const label = labels.get(`${row.refType}:${row.refId}`);
    if (label) {
      ref = { type: row.refType as DirectMessageRefType, id: row.refId, date: row.refDate, label };
    }
  }
  return {
    id: row.id,
    senderId: row.senderId,
    senderName: nameOf(row.sender),
    recipientId: row.recipientId,
    body: row.body,
    hasAttachment: row.attachmentKey !== null,
    attachmentName: row.attachmentName,
    createdAt: row.createdAt.toISOString(),
    ref,
  };
}

/** Batch-resolves every DATE_TASK ref among `rows` to its task's own title in one query, rather
 *  than one lookup per message — same "fine at this company's size, one query beats N" tradeoff
 *  this file already makes elsewhere (listConversationSummaries' own comment). AVAILABILITY_DATE
 *  and PTO_REQUEST are declared on DirectMessageRefType (prisma/schema.prisma's own doc comment
 *  reserved all three from the start) but nothing attaches those yet — only DATE_TASK actually
 *  gets written today, so this only resolves that kind; an unresolvable ref just renders as a
 *  plain message with no card, never an error. */
async function resolveRefLabels(
  tx: { dateTask: { findMany: (args: unknown) => Promise<{ id: string; title: string }[]> } },
  rows: MessageRow[]
): Promise<Map<string, string>> {
  const taskIds = [...new Set(rows.filter((r) => r.refType === "DATE_TASK" && r.refId).map((r) => r.refId as string))];
  const labels = new Map<string, string>();
  if (taskIds.length === 0) return labels;
  const tasks = await tx.dateTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } });
  for (const t of tasks) labels.set(`DATE_TASK:${t.id}`, t.title);
  return labels;
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
  const [rows, lastRead] = await Promise.all([
    withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
      return tx.directMessage.findMany({
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
    }),
    getLastReadMap(actor),
  ]);

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
      unread: 0,
    };
    entry.total += 1;
    if (!mine) {
      entry.fromOthers += 1;
      // See TeamNoteTopicCountDTO's own comment in src/types/index.ts for why `unread` (this
      // viewer's real last-read time for THIS conversation) is a separate number from
      // `fromOthers` (every message anyone else ever sent here, read or not).
      if (isUnread(lastRead, threadKeyForDirectMessage(actor.id, otherId), row.createdAt)) entry.unread += 1;
    }
    // Rows arrive oldest-first, so the last one written here is always the most recent.
    entry.lastMessage = row.body;
    entry.lastMessageAt = row.createdAt.toISOString();
    byCounterpart.set(otherId, entry);
  }
  return [...byCounterpart.values()];
}

/**
 * One DM thread with `otherEmployeeId`, oldest first, like a normal chat log — same convention
 * listTeamNotes uses. No assertCanAccessEmployeeRecords check here (unlike listTeamNotes): a DM
 * isn't about whose HR record this is, it's just "did I send or receive it," which the where
 * clause below already expresses and prisma/rls.sql's direct_message_select backs up
 * independently.
 */
export async function listMessages(actor: CurrentEmployee, otherEmployeeId: string): Promise<DirectMessageDTO[]> {
  const messages = await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows: MessageRow[] = await tx.directMessage.findMany({
      where: {
        OR: [
          { senderId: actor.id, recipientId: otherEmployeeId },
          { senderId: otherEmployeeId, recipientId: actor.id },
        ],
      },
      include: { sender: { select: { firstName: true, lastName: true, preferredName: true } } },
      orderBy: { createdAt: "asc" },
    });
    const labels = await resolveRefLabels(tx, rows);
    return rows.map((row) => toDTO(row, labels));
  });

  // Correction brief #1 — see listTeamNotes' matching comment in src/lib/team-notes.ts for why
  // this lives here rather than a separate "mark read" call the client has to remember to make.
  await markThreadRead(actor, threadKeyForDirectMessage(actor.id, otherEmployeeId));

  return messages;
}

/**
 * Sends one DM from `actor` to `recipientId`. At least a body or an attachment is required (same
 * "a blank message isn't a real post" rule postTeamNote uses), and you can't message yourself.
 * `recipientId` is checked against a real Employee row rather than trusted outright — RLS would
 * still stop a bogus id from ever being readable back, but failing fast here gives a real error
 * message instead of a silently orphaned row.
 *
 * `ref` attaches the reference-card columns reserved on DirectMessage since the start (see its
 * own doc comment in prisma/schema.prisma) — CB, Sept 2026: "I should be able to kind of like
 * reference within the conversation of my message with a specific team member." Nothing in this
 * app's own UI lets someone attach one directly yet; today the only caller is
 * addDateTaskComment's mirror (src/lib/date-tasks.ts), which passes the task it was posted from.
 */
export async function postMessage(
  actor: CurrentEmployee,
  recipientId: string,
  body: string,
  attachment?: { key: string; name: string },
  ref?: { type: "DATE_TASK"; id: string; date: string | null }
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

    const row: MessageRow = await tx.directMessage.create({
      data: {
        senderId: actor.id,
        recipientId,
        body: trimmedBody,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
        refType: ref?.type ?? null,
        refId: ref?.id ?? null,
        refDate: ref?.date ?? null,
      },
      include: { sender: { select: { firstName: true, lastName: true, preferredName: true } } },
    });
    const labels = await resolveRefLabels(tx, [row]);
    return toDTO(row, labels);
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
