import { withRlsContext } from "@/lib/db";
import { assertCanAccessEmployeeRecords } from "@/lib/authorization";
import { getSignedDownloadUrl } from "@/lib/storage";
import type { CurrentEmployee, TeamNoteDTO } from "@/types";

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

type NoteRow = {
  id: string;
  employeeId: string;
  authorId: string;
  body: string;
  attachmentKey: string | null;
  attachmentName: string | null;
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
  };
}

/**
 * A team member's whole notes/messaging thread — self, their supervisor, or an admin may
 * read it (assertCanAccessEmployeeRecords is the same three-way rule prisma/rls.sql's
 * team_note_select backs up independently). Oldest first, like a normal chat log.
 */
export async function listTeamNotes(actor: CurrentEmployee, employeeId: string): Promise<TeamNoteDTO[]> {
  await assertCanAccessEmployeeRecords(actor, employeeId);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.teamNote.findMany({
      where: { employeeId },
      include: { author: { select: { firstName: true, lastName: true, preferredName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDTO);
  });
}

/**
 * Posts one message into `employeeId`'s thread, authored by `actor` (never client-supplied —
 * the whole point of a thread is knowing who actually said what). At least a body or an
 * attachment is required; a blank message with nothing attached isn't a real post.
 */
export async function postTeamNote(
  actor: CurrentEmployee,
  employeeId: string,
  body: string,
  attachment?: { key: string; name: string }
): Promise<TeamNoteDTO> {
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
 * documents.ts's getDocumentForDownload uses.
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
