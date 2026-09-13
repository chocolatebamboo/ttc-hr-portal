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
  await tx.notification.create({
    data: {
      recipientId: params.recipientId,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      targetType: params.targetType,
      targetId: params.targetId,
    },
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

/** "Clear all" — marks every currently-unread notification read in one call, same convenience
 *  markAllNotificationsRead-shaped actions elsewhere in this app (e.g. TeamNote's own read
 *  tracking) already offer rather than requiring one click per row. */
export async function markAllNotificationsRead(actor: CurrentEmployee): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    await tx.notification.updateMany({
      where: { recipientId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
  });
}
