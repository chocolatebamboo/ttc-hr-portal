import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { getSignedDownloadUrl } from "@/lib/storage";
import { isStaff, ForbiddenError } from "@/lib/authorization";
import { formatTime12h } from "@/lib/availability-format";
import {
  threadKeyForDirectMessage,
  markThreadRead,
  getLastReadMap,
  getPeerLastRead,
  isUnread,
} from "@/lib/message-read-state";
import {
  QUICK_REACTION_EMOJIS,
  type AvailabilitySlot,
  type CurrentEmployee,
  type DirectConversationSummaryDTO,
  type DirectMessageCommentDTO,
  type DirectMessageDTO,
  type DirectMessageReactionSummaryDTO,
  type DirectMessageReplyPreviewDTO,
  type DirectMessageRefDTO,
  type DirectMessageRefType,
  type DirectMessageThreadDTO,
  type DirectScheduledMessageDTO,
} from "@/types";

/** Background actor for the scheduled-message dispatch cron — same reasoning as every other
 *  SYSTEM_ACTOR in this codebase (e.g. shift-reminders.ts): no signed-in employee behind a
 *  scheduled run. Unlike those, DirectMessage's own RLS has no blanket is_admin() bypass (these
 *  are personal messages — see direct_message_select in prisma/rls.sql), so this exact literal
 *  employeeId is what direct_message_system_dispatch checks for instead — a real employee id is
 *  always a uuid, so nothing else can ever match it. */
const SCHEDULED_MESSAGE_SYSTEM_ACTOR = { employeeId: "system:scheduled-messages", role: "SUPER_ADMIN" };

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

/** The columns a reply preview needs from its target message — deliberately thin, matching
 *  DirectMessageReplyPreviewDTO itself (see that type's own comment in src/types/index.ts). */
type ReplyTargetRow = {
  id: string;
  body: string;
  attachmentKey: string | null;
  sender: NameFields;
};

type ReactionRow = { emoji: string; employeeId: string };

type CommentRow = { id: string; authorId: string; body: string; createdAt: Date; author: NameFields };

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
  replyTo: ReplyTargetRow | null;
  chainRootId: string | null;
  reactions: ReactionRow[];
  comments: CommentRow[];
  _count: { chainReplies: number };
};

/** The `include` shape every query in this file that returns a full MessageRow shares, so the
 *  reply-preview, reactions, and comments columns can't silently drift out of sync between
 *  listMessages, postMessage, etc. `comments` is included unconditionally here — RLS
 *  (direct_message_comment_select in prisma/rls.sql) already returns nothing to a non-staff
 *  actor at the database level, and toDTO below adds its own explicit `actorIsStaff` check on
 *  top rather than just trusting that silently, same "app layer first, RLS as the independent
 *  second check" division every other access rule in this codebase follows.
 *
 *  `_count.chainReplies` (reply-chain redesign, Sept 2026) is how many messages have this one as
 *  their `chainRootId` — only ever non-zero for a top-level message, see DirectMessageDTO's own
 *  `replyCount` doc comment in src/types/index.ts. `chainRootId` itself (a plain scalar column,
 *  not a relation) comes back automatically with every query regardless of `include`/`select`
 *  shape here, same as `createdAt` — listed on MessageRow above for that reason, not because
 *  this object adds it. */
const MESSAGE_INCLUDE = {
  sender: { select: { firstName: true, lastName: true, preferredName: true } },
  replyTo: {
    select: {
      id: true,
      body: true,
      attachmentKey: true,
      sender: { select: { firstName: true, lastName: true, preferredName: true } },
    },
  },
  reactions: { select: { emoji: true, employeeId: true } },
  comments: {
    select: {
      id: true,
      authorId: true,
      body: true,
      createdAt: true,
      author: { select: { firstName: true, lastName: true, preferredName: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  _count: { select: { chainReplies: true } },
} as const;

function toCommentDTO(c: CommentRow): DirectMessageCommentDTO {
  return { id: c.id, authorId: c.authorId, authorName: nameOf(c.author), body: c.body, createdAt: c.createdAt.toISOString() };
}

/** Folds one message's raw reaction rows down to the display shape — CB, Sept 2026: "I should
 *  have the options to include emojis to react to other people's replies." Grouped by emoji
 *  (each person can hold more than one different reaction on the same message, see
 *  DirectMessageReaction's own doc comment in prisma/schema.prisma) and ordered to match
 *  QUICK_REACTION_EMOJIS rather than insertion order, so the row of pills under a message doesn't
 *  reshuffle as different people react. */
function summarizeReactions(reactions: ReactionRow[], actorId: string): DirectMessageReactionSummaryDTO[] {
  const byEmoji = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const r of reactions) {
    const entry = byEmoji.get(r.emoji) ?? { count: 0, reactedByMe: false };
    entry.count += 1;
    if (r.employeeId === actorId) entry.reactedByMe = true;
    byEmoji.set(r.emoji, entry);
  }
  return QUICK_REACTION_EMOJIS.filter((e) => byEmoji.has(e)).map((emoji) => ({ emoji, ...byEmoji.get(emoji)! }));
}

/** Turns a raw ref{Type,Id,Date} triple into the labeled DTO shape the client actually renders
 *  — the reference card CB asked for ("I should be able to kind of like reference within the
 *  conversation of my message with a specific team member"), first wired up for DATE_TASK:
 *  every comment posted on a task now mirrors here (see addDateTaskComment's own doc comment in
 *  src/lib/date-tasks.ts) so the conversation it came from is one tap away from the DM it shows
 *  up in. `labels` is a pre-resolved id->label map (see resolveRefLabels below) — keeping the
 *  actual lookup out of this function means toDTO stays a plain sync mapper, same as before.
 *  `actorId` is only needed for the reactions summary's `reactedByMe` flag. `actorIsStaff` gates
 *  `comments` (Phase 5c, "hidden from the team member") — see DirectMessageCommentDTO's own doc
 *  comment in src/types/index.ts for why this is an explicit empty-array here rather than just
 *  relying on the include already having come back empty for a non-staff actor. */
function toDTO(row: MessageRow, labels: Map<string, string>, actorId: string, actorIsStaff: boolean): DirectMessageDTO {
  let ref: DirectMessageRefDTO | null = null;
  if (row.refType && row.refId) {
    // Keyed by date as well as type+id (Phase 5d) — a DATE_TASK only ever has one date, so this
    // is a no-op there, but an AVAILABILITY_DATE ref's `id` is a whole AvailabilitySubmission,
    // which can cover several dates each with its own time range — see resolveRefLabels below.
    const label = labels.get(`${row.refType}:${row.refId}:${row.refDate ?? ""}`);
    if (label) {
      ref = { type: row.refType as DirectMessageRefType, id: row.refId, date: row.refDate, label };
    }
  }
  const replyTo: DirectMessageReplyPreviewDTO | null = row.replyTo
    ? {
        id: row.replyTo.id,
        senderName: nameOf(row.replyTo.sender),
        body: row.replyTo.body,
        hasAttachment: row.replyTo.attachmentKey !== null,
      }
    : null;
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
    replyTo,
    chainRootId: row.chainRootId,
    replyCount: row._count.chainReplies,
    reactions: summarizeReactions(row.reactions, actorId),
    comments: actorIsStaff ? row.comments.map(toCommentDTO) : [],
  };
}

/** Batch-resolves every ref among `rows` to a display label in (at most) one query per ref type,
 *  rather than one lookup per message — same "fine at this company's size, one query beats N"
 *  tradeoff this file already makes elsewhere (listConversationSummaries' own comment).
 *  DATE_TASK resolves to the task's own title, one row per task. AVAILABILITY_DATE (Phase 5d,
 *  CB: "chat icons on availability requests linked to specific dates") resolves to that one
 *  date's own time range, e.g. "9:00 AM–5:00 PM" — a submission's `slots` can cover several
 *  dates, so this fans one fetched submission out into one label per date it actually has, keyed
 *  by date (see toDTO's own lookup above). Round two (Sept 2026), CB: "I'm still not seeing it
 *  be in line to... see that card information" — the card-level chat icon (not scoped to one
 *  date) now attaches the same AVAILABILITY_DATE ref type with `date: null` for the "N dates
 *  submitted" case; this loop also writes that summary label under the empty-date key so toDTO's
 *  lookup (`refDate ?? ""`) resolves it the same way a specific date's label does. PTO_REQUEST is
 *  declared on DirectMessageRefType (prisma/schema.prisma's own doc comment reserved all three
 *  from the start) but nothing attaches it yet. An unresolvable ref just renders as a plain
 *  message with no card, never an error — same as an id that's since been deleted. */
async function resolveRefLabels(
  tx: PrismaClient,
  rows: MessageRow[]
): Promise<Map<string, string>> {
  const taskIds = [...new Set(rows.filter((r) => r.refType === "DATE_TASK" && r.refId).map((r) => r.refId as string))];
  const availabilityIds = [
    ...new Set(rows.filter((r) => r.refType === "AVAILABILITY_DATE" && r.refId).map((r) => r.refId as string)),
  ];
  const labels = new Map<string, string>();

  if (taskIds.length > 0) {
    const tasks = await tx.dateTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true, taskDate: true } });
    for (const t of tasks) labels.set(`DATE_TASK:${t.id}:${t.taskDate}`, t.title);
  }

  if (availabilityIds.length > 0) {
    const submissions = await tx.availabilitySubmission.findMany({
      where: { id: { in: availabilityIds } },
      select: { id: true, slots: true },
    });
    for (const s of submissions) {
      const slots = s.slots as unknown as AvailabilitySlot[];
      for (const slot of slots) {
        labels.set(`AVAILABILITY_DATE:${s.id}:${slot.date}`, `${formatTime12h(slot.startTime)}–${formatTime12h(slot.endTime)}`);
      }
      labels.set(`AVAILABILITY_DATE:${s.id}:`, `${slots.length} ${slots.length === 1 ? "date" : "dates"} submitted`);
    }
  }

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
        // "Schedule message" (Sept 2026): a still-pending scheduled message isn't really "in
        // the conversation" yet for either side — excluded from every count/preview here, same
        // as listMessages below. It only ever shows up in the sender's own dedicated
        // `scheduled` list inside an open thread.
        where: { OR: [{ senderId: actor.id }, { recipientId: actor.id }], sentAt: { not: null } },
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
 *
 * Also returns `otherLastReadAt` (CB, Sept 2026: "I should be able to see also when they read
 * the message on their side") — fetched after markThreadRead below runs, not before: reading
 * this thread is itself what the OTHER person will eventually see reflected back as their own
 * "Seen" mark, but fetching their timestamp first-vs-last here makes no difference to what THIS
 * call returns (only actor's own read state changes below, never the peer's).
 *
 * And `scheduled` (Sept 2026, "Schedule message") — actor's own still-pending scheduled
 * messages to `otherEmployeeId`, oldest-due-first. Queried separately from the main `messages`
 * list rather than folded in with a "sentAt IS NULL" branch in the same query: they're a
 * different shape entirely (DirectScheduledMessageDTO, not DirectMessageDTO — no reactions, no
 * replies, nothing to resolve a ref label for) and only ever the actor's own, never the peer's,
 * so keeping the query separate is clearer than one query doing two jobs.
 */
export async function listMessages(actor: CurrentEmployee, otherEmployeeId: string): Promise<DirectMessageThreadDTO> {
  const { messages, scheduled } = await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows: MessageRow[] = await tx.directMessage.findMany({
      where: {
        OR: [
          { senderId: actor.id, recipientId: otherEmployeeId },
          { senderId: otherEmployeeId, recipientId: actor.id },
        ],
        // "Schedule message" (Sept 2026): a still-pending scheduled message is invisible here to
        // BOTH sides — even the sender's own thread view — until it's actually gone out. The
        // sender manages it via the separate `scheduledRows` query below instead.
        sentAt: { not: null },
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    const labels = await resolveRefLabels(tx, rows);
    const actorIsStaff = isStaff(actor);

    const scheduledRows: {
      id: string;
      body: string;
      attachmentKey: string | null;
      attachmentName: string | null;
      scheduledFor: Date | null;
    }[] = await tx.directMessage.findMany({
      where: { senderId: actor.id, recipientId: otherEmployeeId, sentAt: null },
      select: { id: true, body: true, attachmentKey: true, attachmentName: true, scheduledFor: true },
      orderBy: { scheduledFor: "asc" },
    });

    return {
      messages: rows.map((row) => toDTO(row, labels, actor.id, actorIsStaff)),
      scheduled: scheduledRows.map(
        (s): DirectScheduledMessageDTO => ({
          id: s.id,
          body: s.body,
          hasAttachment: s.attachmentKey !== null,
          attachmentName: s.attachmentName,
          // Not null for any row this query can return (that's exactly what postMessage sets
          // alongside a null sentAt for a scheduled message), so this cast is safe.
          scheduledFor: s.scheduledFor!.toISOString(),
        })
      ),
    };
  });

  // Correction brief #1 — see listTeamNotes' matching comment in src/lib/team-notes.ts for why
  // this lives here rather than a separate "mark read" call the client has to remember to make.
  await markThreadRead(actor, threadKeyForDirectMessage(actor.id, otherEmployeeId));

  const otherLastReadAtDate = await getPeerLastRead(actor, otherEmployeeId);

  return { messages, otherLastReadAt: otherLastReadAtDate ? otherLastReadAtDate.toISOString() : null, scheduled };
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
 * reference within the conversation of my message with a specific team member." Two callers today:
 * addDateTaskComment's mirror (src/lib/date-tasks.ts), server-side only, passes the task it was
 * posted from; and, as of Phase 5d, POST /api/messages/dm/[employeeId] accepts an AVAILABILITY_DATE
 * ref straight from the client (see that route's own doc comment) when the message was started
 * from a date's own "Message about this date" button — DATE_TASK is deliberately NOT accepted from
 * that route, since there's no client UI for attaching one and no access check here that would
 * verify the caller can actually see a client-supplied task id.
 *
 * `replyToId` is CB's "reply to a specific message within the message thread" (Sept 2026) — the
 * id of an existing message to quote. Re-checked against this same thread (not just any message
 * the actor can read) so a reply can't point at some OTHER conversation's message; a bad or
 * cross-thread id fails the whole post rather than silently dropping the reply. Reply-chain
 * redesign (Sept 2026): the client always passes a THREAD ROOT's id here (opening or adding to
 * that message's own "View N replies" panel), but this resolves `chainRootId` from the target's
 * own `chainRootId ?? target.id` rather than trusting that — so even a stale client, or a reply
 * passed in by id instead of its thread's root, still flattens to the true top-level ancestor
 * instead of creating an orphaned sub-thread nothing ever displays. A still-scheduled (not yet
 * sent) message can't be replied to — nobody but its own sender can even see it exists.
 *
 * `scheduledFor` is "Schedule message" (Sept 2026, confirmed for deployment): when given, this
 * post doesn't go out now — the row is created immediately (so the sender can see/manage it as
 * pending) but stays invisible to everyone, including the sender's own normal thread view, until
 * POST /api/cron/scheduled-messages flips it once that time has passed (see
 * sendDueScheduledMessages below). Must be strictly in the future; a past-or-now timestamp is
 * just an immediate send, so that's rejected rather than silently reinterpreted.
 */
export async function postMessage(
  actor: CurrentEmployee,
  recipientId: string,
  body: string,
  attachment?: { key: string; name: string },
  ref?: { type: "DATE_TASK" | "AVAILABILITY_DATE"; id: string; date: string | null },
  replyToId?: string | null,
  scheduledFor?: Date | null
): Promise<DirectMessageDTO> {
  if (recipientId === actor.id) {
    throw new InvalidDirectMessageError("You can't message yourself.");
  }
  const trimmedBody = body.trim();
  if (!trimmedBody && !attachment) {
    throw new InvalidDirectMessageError("Write a message or attach a file.");
  }
  if (scheduledFor && scheduledFor.getTime() <= Date.now()) {
    throw new InvalidDirectMessageError("Pick a time in the future to schedule this for.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const recipient = await tx.employee.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!recipient) {
      throw new InvalidDirectMessageError("That person couldn't be found.");
    }

    let resolvedReplyToId: string | null = null;
    let resolvedChainRootId: string | null = null;
    if (replyToId) {
      const target = await tx.directMessage.findFirst({
        where: {
          id: replyToId,
          sentAt: { not: null },
          OR: [
            { senderId: actor.id, recipientId },
            { senderId: recipientId, recipientId: actor.id },
          ],
        },
        select: { id: true, chainRootId: true },
      });
      if (!target) {
        throw new InvalidDirectMessageError("That message can't be replied to.");
      }
      resolvedReplyToId = target.id;
      resolvedChainRootId = target.chainRootId ?? target.id;
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
        replyToId: resolvedReplyToId,
        chainRootId: resolvedChainRootId,
        scheduledFor: scheduledFor ?? null,
        sentAt: scheduledFor ? null : new Date(),
      },
      include: MESSAGE_INCLUDE,
    });
    const labels = await resolveRefLabels(tx, [row]);
    return toDTO(row, labels, actor.id, isStaff(actor));
  });
}

/**
 * Cancels one of the actor's OWN still-pending scheduled messages — "Schedule message" (Sept
 * 2026). Hard-deletes the row (never sent, never seen by the recipient, so there's nothing to
 * preserve an audit trail of) rather than just clearing `scheduledFor`, matching how a scheduled-
 * but-unsent email's own "cancel" normally works elsewhere. Only the sender, and only before it's
 * gone out — prisma/rls.sql's direct_message_delete backs up both halves of that independently.
 */
export async function cancelScheduledMessage(actor: CurrentEmployee, messageId: string): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const result = await tx.directMessage.deleteMany({
      where: { id: messageId, senderId: actor.id, sentAt: null },
    });
    if (result.count === 0) {
      throw new DirectMessageNotFoundError("That scheduled message can't be found, or has already gone out.");
    }
  });
}

export interface ScheduledMessageDispatchResult {
  checked: number;
  sent: number;
}

/**
 * Finds every DirectMessage whose `scheduledFor` has passed and hasn't gone out yet, and marks
 * it sent — "Schedule message" (Sept 2026, confirmed for deployment). Called by
 * POST /api/cron/scheduled-messages, meant to be hit every 10-15 minutes the same way the other
 * three /api/cron/* jobs already are (see README's "What actually calls those... cron endpoints
 * on a schedule") — a message scheduled for, say, 3:00 PM goes out sometime within that same
 * window, not necessarily on the exact minute. A plain updateMany rather than one row at a time:
 * there's nothing per-row to do besides the timestamp flip (no email, no side effect), so one
 * bulk write is both simpler and avoids any per-row failure needing its own retry bookkeeping.
 */
export async function sendDueScheduledMessages(): Promise<ScheduledMessageDispatchResult> {
  return withRlsContext(SCHEDULED_MESSAGE_SYSTEM_ACTOR, async (tx) => {
    const due: { id: string }[] = await tx.directMessage.findMany({
      where: { sentAt: null, scheduledFor: { lte: new Date() } },
      select: { id: true },
    });
    if (due.length === 0) {
      return { checked: 0, sent: 0 };
    }
    const result = await tx.directMessage.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { sentAt: new Date() },
    });
    return { checked: due.length, sent: result.count };
  });
}

/**
 * Toggles one quick-reaction from `actor` on `messageId` — CB, Sept 2026: "I should have the
 * options to include emojis to react to other people's replies." A second call with the same
 * emoji removes it (tap-to-toggle, same as iMessage's own tapback UI); a call with a different
 * emoji ADDS a second reaction rather than replacing the first (see DirectMessageReaction's own
 * doc comment in prisma/schema.prisma for why). Returns the message's full updated reaction
 * summary so the client can just replace that one message's `reactions` array, rather than
 * re-fetching the whole thread.
 */
export async function toggleReaction(
  actor: CurrentEmployee,
  messageId: string,
  emoji: string
): Promise<DirectMessageReactionSummaryDTO[]> {
  if (!(QUICK_REACTION_EMOJIS as readonly string[]).includes(emoji)) {
    throw new InvalidDirectMessageError("That's not a reaction you can use here.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    // sentAt filter (Sept 2026, "Schedule message"): can't react to a still-pending scheduled
    // message — nobody but its own sender can even see it exists yet.
    const message = await tx.directMessage.findFirst({
      where: { id: messageId, sentAt: { not: null }, OR: [{ senderId: actor.id }, { recipientId: actor.id }] },
      select: { id: true },
    });
    if (!message) {
      throw new DirectMessageNotFoundError();
    }

    const existing = await tx.directMessageReaction.findUnique({
      where: { messageId_employeeId_emoji: { messageId, employeeId: actor.id, emoji } },
      select: { id: true },
    });
    if (existing) {
      await tx.directMessageReaction.delete({ where: { id: existing.id } });
    } else {
      await tx.directMessageReaction.create({ data: { messageId, employeeId: actor.id, emoji } });
    }

    const reactions: ReactionRow[] = await tx.directMessageReaction.findMany({
      where: { messageId },
      select: { emoji: true, employeeId: true },
    });
    return summarizeReactions(reactions, actor.id);
  });
}

/**
 * Phase 5c (CB, Sept 2026): "an option to add an internal comment," confirmed scope "hidden
 * from the team member." Staff only (isStaff — SUPER_ADMIN/HR_ADMIN/SUPERVISOR; see
 * src/lib/authorization.ts), enforced here AND independently by direct_message_comment_insert
 * in prisma/rls.sql. Returns the message's full updated comment list (oldest first), same
 * "return the whole updated collection, not just the new row" shape toggleReaction above uses
 * for reactions, so the client can just replace that one message's `comments` array.
 */
export async function addComment(
  actor: CurrentEmployee,
  messageId: string,
  body: string
): Promise<DirectMessageCommentDTO[]> {
  if (!isStaff(actor)) {
    throw new ForbiddenError();
  }
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    throw new InvalidDirectMessageError("Write something for the note.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    // sentAt filter (Sept 2026, "Schedule message"): same reasoning as toggleReaction's own —
    // no notes on a message that hasn't gone out yet.
    const message = await tx.directMessage.findFirst({
      where: { id: messageId, sentAt: { not: null }, OR: [{ senderId: actor.id }, { recipientId: actor.id }] },
      select: { id: true },
    });
    if (!message) {
      throw new DirectMessageNotFoundError();
    }

    await tx.directMessageComment.create({ data: { messageId, authorId: actor.id, body: trimmedBody } });

    const comments: CommentRow[] = await tx.directMessageComment.findMany({
      where: { messageId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        authorId: true,
        body: true,
        createdAt: true,
        author: { select: { firstName: true, lastName: true, preferredName: true } },
      },
    });
    return comments.map(toCommentDTO);
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
