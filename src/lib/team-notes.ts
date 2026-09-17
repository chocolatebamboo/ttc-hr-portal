import { withRlsContext } from "@/lib/db";
import { assertCanAccessEmployeeRecords, assertIsAdmin } from "@/lib/authorization";
import { getSignedDownloadUrl } from "@/lib/storage";
import { threadKeyForTeamNote, markThreadRead, getLastReadMap, isUnread } from "@/lib/message-read-state";
import type { CurrentEmployee, TeamNoteDTO, TeamNoteTopicCountDTO, TeamNoteTopicType } from "@/types";

export class InvalidTeamNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTeamNoteError";
  }
}

export class TeamNoteNotFoundError extends Error {
  constructor(message = "That note couldn't be found.") {
    super(message);
    this.name = "TeamNoteNotFoundError";
  }
}

/** What one note is "about," beyond just the employee it belongs to — see TeamNote's doc
 *  comment in prisma/schema.prisma. Omit entirely (or pass undefined) for the general thread. */
export interface TeamNoteTopic {
  type: TeamNoteTopicType;
  id: string;
  /** AVAILABILITY_DATE only — "YYYY-MM-DD". Must be omitted for PTO_REQUEST and SHIFT. */
  date?: string;
}

function assertValidTopic(topic: TeamNoteTopic | undefined): void {
  if (!topic) return;
  if (topic.type === "AVAILABILITY_DATE" && !topic.date) {
    throw new InvalidTeamNoteError("A specific date is required for an availability conversation.");
  }
  if ((topic.type === "PTO_REQUEST" || topic.type === "SHIFT") && topic.date) {
    throw new InvalidTeamNoteError(
      topic.type === "PTO_REQUEST"
        ? "A PTO conversation isn't scoped to a specific date."
        : "A shift conversation isn't scoped to a separate date — the shift is already one specific date."
    );
  }
}

type NoteRow = {
  id: string;
  employeeId: string;
  authorId: string;
  body: string;
  attachmentKey: string | null;
  attachmentName: string | null;
  topicType: string | null;
  topicId: string | null;
  topicDate: string | null;
  createdAt: Date;
  author: { firstName: string; lastName: string; preferredName: string | null };
};

function toDTO(row: NoteRow): TeamNoteDTO {
  return {
    id: row.id,
    employeeId: row.employeeId,
    authorId: row.authorId,
    authorName: `${row.author.preferredName || row.author.firstName} ${row.author.lastName}`,
    body: row.body,
    hasAttachment: row.attachmentKey !== null,
    attachmentName: row.attachmentName,
    createdAt: row.createdAt.toISOString(),
    topicType: row.topicType as TeamNoteTopicType | null,
    topicId: row.topicId,
    topicDate: row.topicDate,
  };
}

/**
 * A team member's notes/messaging thread — self, their supervisor, or an admin may read it
 * (assertCanAccessEmployeeRecords is the same three-way rule prisma/rls.sql's team_note_select
 * backs up independently). Oldest first, like a normal chat log.
 *
 * Without `topic`, this is the one general thread (src/app/(portal)/team/[employeeId] and
 * /notes) — every note posted before the Sept 2026 topic-scoping change, and anything posted
 * there since. With `topic`, it's the narrower conversation about just that one availability
 * date or PTO request (TeamAvailabilityCards / TeamPtoCards) — a completely separate list, not
 * a filtered view of the general one.
 */
export async function listTeamNotes(
  actor: CurrentEmployee,
  employeeId: string,
  topic?: TeamNoteTopic
): Promise<TeamNoteDTO[]> {
  assertValidTopic(topic);
  await assertCanAccessEmployeeRecords(actor, employeeId);

  const notes = await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.teamNote.findMany({
      where: topic
        ? { employeeId, topicType: topic.type, topicId: topic.id, topicDate: topic.date ?? null }
        : { employeeId, topicType: null },
      include: { author: { select: { firstName: true, lastName: true, preferredName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDTO);
  });

  // Correction brief #1: "opening/viewing a message must immediately mark that message as
  // read... reading a message from another entry point must produce the same result." Every
  // surface that opens this thread (My Messages inbox, TeamAvailabilityCards/TeamPtoCards'
  // admin cards, AvailabilityCalendar, TimesheetView, TeamScheduleView/ScheduleView) calls
  // listTeamNotes to fetch it, so marking read HERE — once — covers all of them without each
  // caller needing its own "mark read" step. Fire-and-forget-safe to do even when `notes` is
  // empty: an employee opening a brand new, empty thread has still "read" it (there's nothing
  // unread left to show), same as Notification's own read-on-click convention.
  await markThreadRead(actor, threadKeyForTeamNote(employeeId, topic));

  return notes;
}

/**
 * Posts one message into `employeeId`'s thread (the general one, or a specific topic — see
 * listTeamNotes), authored by `actor` (never client-supplied — the whole point of a thread is
 * knowing who actually said what). At least a body or an attachment is required; a blank
 * message with nothing attached isn't a real post.
 */
export async function postTeamNote(
  actor: CurrentEmployee,
  employeeId: string,
  body: string,
  attachment?: { key: string; name: string },
  topic?: TeamNoteTopic
): Promise<TeamNoteDTO> {
  assertValidTopic(topic);
  await assertCanAccessEmployeeRecords(actor, employeeId);

  const trimmedBody = body.trim();
  if (!trimmedBody && !attachment) {
    throw new InvalidTeamNoteError("Write a message or attach a file.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.teamNote.create({
      data: {
        employeeId,
        authorId: actor.id,
        body: trimmedBody,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
        topicType: topic?.type ?? null,
        topicId: topic?.id ?? null,
        topicDate: topic?.date ?? null,
      },
      include: { author: { select: { firstName: true, lastName: true, preferredName: true } } },
    });
    return toDTO(row);
  });
}

/**
 * A short-lived signed URL for one message's attachment. Re-checks access from scratch (both
 * assertCanAccessEmployeeRecords here AND the row read itself, which only succeeds under
 * team_note_select) rather than trusting that the caller already saw this note in a prior
 * listTeamNotes call — same "resolve under the caller's own RLS identity, then sign" shape
 * documents.ts's getDocumentForDownload uses. Works the same regardless of which thread (or
 * topic) the note belongs to — access is still purely about employeeId.
 */
export async function getTeamNoteAttachmentUrl(
  actor: CurrentEmployee,
  employeeId: string,
  noteId: string
): Promise<string> {
  await assertCanAccessEmployeeRecords(actor, employeeId);

  const row: { employeeId: string; attachmentKey: string | null } | null = await withRlsContext(
    { employeeId: actor.id, role: actor.role },
    async (tx) => {
      return tx.teamNote.findUnique({
        where: { id: noteId },
        select: { employeeId: true, attachmentKey: true },
      });
    }
  );

  if (!row || row.employeeId !== employeeId || !row.attachmentKey) {
    throw new TeamNoteNotFoundError();
  }

  return getSignedDownloadUrl(row.attachmentKey);
}

type TopicRow = {
  employeeId: string;
  topicType: string | null;
  topicId: string | null;
  topicDate: string | null;
  authorId: string;
  createdAt: Date;
  employee: { firstName: string; lastName: string; preferredName: string | null };
};

/** Folds raw note rows down to one count per (employeeId, topicType, topicId, topicDate) —
 *  shared by both listTeamNoteTopicCounts (one employee) and listAllTeamNoteTopicCounts (every
 *  employee, admin only) so the two only differ in which rows they fetch. See
 *  TeamNoteTopicCountDTO in src/types/index.ts for what `total`/`fromOthers`/`unread` mean.
 *  `lastRead` is `viewerId`'s own MessageReadState map (src/lib/message-read-state.ts) — `unread`
 *  counts messages from others posted after the viewer last opened THAT topic's own thread, not
 *  after any single shared timestamp. */
function aggregateTopicCounts(
  rows: TopicRow[],
  viewerId: string,
  lastRead: Map<string, Date>
): TeamNoteTopicCountDTO[] {
  const byKey = new Map<string, TeamNoteTopicCountDTO>();
  for (const row of rows) {
    if (!row.topicType || !row.topicId) continue;
    const key = `${row.employeeId}:${row.topicType}:${row.topicId}:${row.topicDate ?? ""}`;
    const entry = byKey.get(key) ?? {
      employeeId: row.employeeId,
      employeeName: `${row.employee.preferredName || row.employee.firstName} ${row.employee.lastName}`,
      topicType: row.topicType as TeamNoteTopicType,
      topicId: row.topicId,
      topicDate: row.topicDate,
      total: 0,
      fromOthers: 0,
      unread: 0,
    };
    entry.total += 1;
    if (row.authorId !== viewerId) {
      entry.fromOthers += 1;
      const threadKey = threadKeyForTeamNote(row.employeeId, {
        type: row.topicType as TeamNoteTopicType,
        id: row.topicId,
        date: row.topicDate ?? undefined,
      });
      if (isUnread(lastRead, threadKey, row.createdAt)) entry.unread += 1;
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/** Per-topic message counts for one employee's own conversations (their availability dates and
 *  PTO requests) — same access rule as listTeamNotes. Used both by that employee's own view
 *  (AvailabilityCalendar, TimesheetView) and by an admin/supervisor opening that one person's
 *  cards, so a chip can show "3 messages" without opening every thread to count. */
export async function listTeamNoteTopicCounts(
  actor: CurrentEmployee,
  employeeId: string
): Promise<TeamNoteTopicCountDTO[]> {
  await assertCanAccessEmployeeRecords(actor, employeeId);

  const [rows, lastRead] = await Promise.all([
    withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
      return tx.teamNote.findMany({
        where: { employeeId, topicType: { not: null } },
        select: {
          employeeId: true,
          topicType: true,
          topicId: true,
          topicDate: true,
          authorId: true,
          createdAt: true,
          employee: { select: { firstName: true, lastName: true, preferredName: true } },
        },
      });
    }),
    getLastReadMap(actor),
  ]);
  return aggregateTopicCounts(rows, actor.id, lastRead);
}

/** The admin-wide version of listTeamNoteTopicCounts — every employee's topic counts in one
 *  query, so TeamAvailabilityCards/TeamPtoCards (which list many people's cards on one page)
 *  can badge every chip with one fetch instead of one per employee. Admin only, same reasoning
 *  as listAdminAvailability/listAdminPto: is_admin() already grants org-wide TeamNote read
 *  access (prisma/rls.sql), so there's nothing extra to check per row. */
export async function listAllTeamNoteTopicCounts(actor: CurrentEmployee): Promise<TeamNoteTopicCountDTO[]> {
  assertIsAdmin(actor);

  const [rows, lastRead] = await Promise.all([
    withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
      return tx.teamNote.findMany({
        where: { topicType: { not: null } },
        select: {
          employeeId: true,
          topicType: true,
          topicId: true,
          topicDate: true,
          authorId: true,
          createdAt: true,
          employee: { select: { firstName: true, lastName: true, preferredName: true } },
        },
      });
    }),
    getLastReadMap(actor),
  ]);
  return aggregateTopicCounts(rows, actor.id, lastRead);
}
