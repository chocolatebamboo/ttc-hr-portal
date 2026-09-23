import { withRlsContext } from "@/lib/db";
import type { CurrentEmployee } from "@/types";
import type { TeamNoteTopic } from "@/lib/team-notes";

/**
 * Correction brief (Sept 2026, "Correction & Refinement Brief" #1): "genuinely unread
 * messages... persist after refresh, logout, and login." See MessageReadState's own doc
 * comment in prisma/schema.prisma for why this is "last time I opened this thread" rather than
 * a read receipt per message.
 *
 * threadKey is intentionally a single opaque string (not a foreign key to a real "Conversation"
 * row — TeamNote/DirectMessage don't have one, same "derive it, don't store it" reasoning their
 * own doc comments already use for conversation identity) so one small table covers every kind
 * of thread this app has today without a union of nullable columns.
 */

/** The TeamNote general thread (no topic) for one employee — src/app/(portal)/team/[employeeId]
 *  and the My Messages inbox's "general" row both resolve to this same key regardless of who's
 *  reading it, since it's one shared thread visible to that employee/their supervisor/admins. */
export function threadKeyForTeamNote(employeeId: string, topic?: TeamNoteTopic): string {
  if (!topic) return `team:${employeeId}`;
  return `team:${employeeId}:${topic.type}:${topic.id}:${topic.date ?? ""}`;
}

/** A DM conversation's key is the same regardless of which of the two participants is asking —
 *  sorted so {a, b} and {b, a} always collide, same idea uploadDirectMessageFile's `pair` uses
 *  in src/lib/storage.ts. */
export function threadKeyForDirectMessage(participantA: string, participantB: string): string {
  return `dm:${[participantA, participantB].sort().join("_")}`;
}

/** Records that `actor` has read `threadKey` as of right now. Called from inside
 *  listTeamNotes/listMessages themselves (see their own comments) rather than as a separate
 *  "mark read" endpoint the client has to remember to call — every entry point that opens a
 *  thread already goes through one of those two functions to fetch its messages, so "opening a
 *  thread" and "marking it read" happen in the same request, automatically, everywhere. */
export async function markThreadRead(actor: CurrentEmployee, threadKey: string): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    await tx.messageReadState.upsert({
      where: { employeeId_threadKey: { employeeId: actor.id, threadKey } },
      create: { employeeId: actor.id, threadKey },
      update: { lastReadAt: new Date() },
    });
  });
}

/** Every threadKey `actor` has ever read, as a Map for O(1) lookup while folding raw message
 *  rows down to per-conversation counts (aggregateTopicCounts in team-notes.ts,
 *  listConversationSummaries in direct-messages.ts). A thread with no entry here has never been
 *  opened by this viewer — every message in it from someone else is unread, same as a brand new
 *  employee account having no Notification rows read yet. */
export async function getLastReadMap(actor: CurrentEmployee): Promise<Map<string, Date>> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows: { threadKey: string; lastReadAt: Date }[] = await tx.messageReadState.findMany({
      where: { employeeId: actor.id },
      select: { threadKey: true, lastReadAt: true },
    });
    return new Map(rows.map((r) => [r.threadKey, r.lastReadAt] as const));
  });
}

/** True if `createdAt` is strictly after the viewer's last read of that thread — the one
 *  comparison every unread computation in team-notes.ts/direct-messages.ts boils down to. */
export function isUnread(lastRead: Map<string, Date>, threadKey: string, createdAt: Date): boolean {
  const read = lastRead.get(threadKey);
  return !read || createdAt > read;
}

/** The OTHER participant's own lastReadAt for one specific DM thread — CB, Sept 2026: "I should
 *  be able to see also when they read the message on their side." Every other function in this
 *  file only ever reads the CALLER's own rows (see the module doc comment on why
 *  MessageReadState is normally strictly own-rows-only); this is the one deliberate, narrow
 *  exception, backed by message_read_state_select_dm_peer in prisma/rls.sql, which widens the
 *  select policy to this one shared thread only — never any other employee's read state on any
 *  other thread. Returns null if they've never opened this thread (no row), same "never opened,
 *  nothing's been seen" meaning getLastReadMap's per-viewer map already carries for the caller's
 *  own side. */
export async function getPeerLastRead(actor: CurrentEmployee, otherEmployeeId: string): Promise<Date | null> {
  const threadKey = threadKeyForDirectMessage(actor.id, otherEmployeeId);
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.messageReadState.findUnique({
      where: { employeeId_threadKey: { employeeId: otherEmployeeId, threadKey } },
      select: { lastReadAt: true },
    });
    return row?.lastReadAt ?? null;
  });
}
