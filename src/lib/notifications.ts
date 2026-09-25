import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import type { CurrentEmployee, NotificationDTO, NotificationType } from "@/types";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  targetType: string;
  targetId: string;
  readAt: Date | null;
  createdAt: Date;
};

function toDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    targetType: row.targetType,
    targetId: row.targetId,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Phase 4 (client spec, Sept 2026): "a real in-app notification feed." Writes one Notification
 * row inside an ALREADY-OPEN transaction — called alongside the real mutation at every event
 * site listed in NotificationType's own doc comment (prisma/schema.prisma: src/lib/shifts.ts,
 * src/lib/availability.ts, src/lib/pto-actions.ts, src/lib/date-tasks.ts), never on its own
 * outside a real action. Deliberately takes the same `tx` the caller is already inside rather
 * than opening its own withRlsContext — a notification is a side effect of the action it
 * describes, so if the transaction rolls back (the action failed), the notification about it
 * should never have existed either. Same "write it inside the same tx as the audit log" shape
 * writeShiftAuditLog already uses in src/lib/shifts.ts, just for the newer recipient-facing
 * table instead of (or, at the four new call sites in phase 4, alongside) AuditLog.
 *
 * Hotfix (Sept 2026): switched from tx.notification.create() to createMany() — the exact same
 * fix, for the exact same reason, as src/lib/audit-log.ts's own hotfix (see that file's doc
 * comment for the full mechanism). Prisma's create() compiles to `INSERT ... RETURNING`, and
 * RETURNING is subject to the table's SELECT policy, not just its INSERT with-check — so
 * Postgres re-checks the just-inserted row against notification_select (prisma/rls.sql), which
 * is `"recipientId" = current_employee_id()`. A notification is *always* written for someone
 * other than the actor doing the reviewing/approving/denying (that's the whole point of this
 * table — this doc comment says so two paragraphs up), so recipientId never equals the acting
 * reviewer's own current_employee_id(), and every single write failed with "new row violates
 * row-level security policy for table \"Notification\"" (Postgres code 42501) — silently
 * rolling back the entire enclosing transaction (the approval/denial/shift/PTO/task action
 * itself, and its audit log entry, included) and surfacing as the generic "Something went
 * wrong" error across every flow that calls this function. createMany() never issues RETURNING
 * (it returns only a row count), so only notification_insert's `with check (true)` applies —
 * same row lands either way, same recipient-only read access afterward, just no attempt to
 * hand the row back to a caller who was never allowed to read someone else's notification in
 * the first place. Confirmed directly against the live database (both the failure and the fix)
 * before shipping this.
 */
export async function writeNotification(
  tx: PrismaClient,
  params: {
    recipientId: string;
    type: NotificationType;
    title: string;
    body?: string;
    targetType: string;
    targetId: string;
  }
): Promise<void> {
  await tx.notification.createMany({
    data: [
      {
        recipientId: params.recipientId,
        type: params.type,
        title: params.title,
        body: params.body ?? null,
        targetType: params.targetType,
        targetId: params.targetId,
      },
    ],
  });
}

/** The signed-in employee's own notifications, newest first — capped at 50 since this backs the
 *  header bell's dropdown feed, not a full history. There's no "load more" here on purpose: a
 *  notification feed people actually read stays short by nature (things get read and age out of
 *  relevance), unlike Reports > Activity History (src/lib/activity.ts), which is the deliberately
 *  unbounded, filterable, admin-facing record of everything. */
export async function listMyNotifications(actor: CurrentEmployee): Promise<NotificationDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.notification.findMany({
      where: { recipientId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map(toDTO);
  });
}

/** Just the unread count — its own query rather than deriving it from listMyNotifications, so
 *  the header bell's badge can poll this cheaply without pulling all 50 rows on every check. */
export async function countUnreadNotifications(actor: CurrentEmployee): Promise<number> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.notification.count({ where: { recipientId: actor.id, readAt: null } })
  );
}

/** Marks one of the signed-in employee's own notifications read. Silently does nothing if the
 *  id doesn't exist or isn't theirs (an updateMany with a where clause, not a findUnique-then-
 *  update) — same reasoning as most other "mark done" actions in this app: whoever's clicking
 *  a notification in their own feed already has the right id, so there's nothing meaningful to
 *  report back beyond "it's read now." notification_update's own RLS policy is the real backstop
 *  either way. */
export async function markNotificationRead(actor: CurrentEmployee, notificationId: string): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    await tx.notification.updateMany({
      where: { id: notificationId, recipientId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
  });
}

/** Marks every currently-unread notification read in one call, same convenience
 *  markAllNotificationsRead-shaped actions elsewhere in this app (e.g. TeamNote's own read
 *  tracking) already offer rather than requiring one click per row. This is "Mark all read" on
 *  the header bell — leaves every row in place, just changes its read state. See
 *  deleteAllNotifications below for the separate, permanent "Clear all." */
export async function markAllNotificationsRead(actor: CurrentEmployee): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    await tx.notification.updateMany({
      where: { recipientId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
  });
}

/** Phase 5a (CB, Sept 2026): "we should be able to swipe left to clear notifications one at a
 *  time." A real delete — the row is gone, not just marked read (that's markNotificationRead
 *  above; this is a different, permanent action). Silently a no-op if the id doesn't exist or
 *  isn't theirs (a deleteMany with a where clause, not findUnique-then-delete) — same reasoning
 *  as markNotificationRead: whoever's swiping a notification in their own feed already has the
 *  right id, so there's nothing meaningful to report back beyond "it's gone now."
 *  notification_delete's own RLS policy is the real backstop either way. */
export async function deleteNotification(actor: CurrentEmployee, notificationId: string): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    await tx.notification.deleteMany({ where: { id: notificationId, recipientId: actor.id } });
  });
}

/** "Clear all" — CB, Sept 2026: "a separate option to clear all notifications," distinct from
 *  the existing "Mark all read" above, which only changes read state and leaves every row in
 *  place. This permanently removes every one of the signed-in employee's own notifications,
 *  read or unread. */
export async function deleteAllNotifications(actor: CurrentEmployee): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    await tx.notification.deleteMany({ where: { recipientId: actor.id } });
  });
}
