import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { writeNotification } from "@/lib/notifications";

/** Background actor for this job — same reasoning as every other SYSTEM_ACTOR in this codebase
 *  (clockout-reminders.ts, clockin-reminders.ts): no signed-in employee behind a scheduled run.
 *  Announcement/AnnouncementAudience carry no RLS at all (see their own schema.prisma comment —
 *  low-sensitivity, read-mostly reference data), so SUPER_ADMIN here is really just about
 *  writeNotification's createMany() call, which doesn't check role either; it's for consistency
 *  with every other background job in this file's family, not because anything here requires it. */
const SYSTEM_ACTOR = { employeeId: "system:announcement-notification", role: "SUPER_ADMIN" };

export interface AnnouncementNotificationResult {
  checked: number;
  notified: number;
  recipientsNotified: number;
  failed: { announcementId: string; error: string }[];
}

type AudienceRow = { departmentId: string | null; employeeId: string | null };

/** Mirrors matchesAudience's own rule in announcements.ts (no audience rows = "Everyone"), just
 *  resolved the other direction: given an announcement's audience rows, who gets notified —
 *  rather than given an employee, does this announcement match them. Deactivated employees are
 *  left out either way, same "active only" convention as every other broadcast-style query in
 *  this app (e.g. documents.ts's assignment counts, onboarding.ts's roster). */
async function resolveRecipientIds(tx: PrismaClient, audiences: AudienceRow[]): Promise<string[]> {
  if (audiences.length === 0) {
    const everyone = await tx.employee.findMany({ where: { deactivatedAt: null }, select: { id: true } });
    return everyone.map((e) => e.id);
  }

  const employeeIds = audiences.map((a) => a.employeeId).filter((id): id is string => Boolean(id));
  const departmentIds = audiences.map((a) => a.departmentId).filter((id): id is string => Boolean(id));

  const fromDepartments =
    departmentIds.length > 0
      ? await tx.employee.findMany({
          where: { departmentId: { in: departmentIds }, deactivatedAt: null },
          select: { id: true },
        })
      : [];

  const active =
    employeeIds.length > 0
      ? await tx.employee.findMany({
          where: { id: { in: employeeIds }, deactivatedAt: null },
          select: { id: true },
        })
      : [];

  return Array.from(new Set([...active.map((e) => e.id), ...fromDepartments.map((e) => e.id)]));
}

/**
 * My Profile > Notifications (CB, Oct 2026): "if we get an announcement... those are
 * notifications too." Announcement.publishDate can be future-dated (an admin can schedule a post
 * ahead of time — see createAnnouncement's own doc comment in announcements.ts), so notifying at
 * creation time would fire before anyone could actually see the post; this cron instead finds
 * every announcement whose publishDate has actually passed and hasn't been notified yet, writes
 * one in-app Notification (type ANNOUNCEMENT_POSTED) per resolved recipient — same
 * writeNotification path every other notification in this app goes through, so
 * sendPendingNotificationEmails (src/lib/notification-emails.ts) picks these up and emails them
 * too, gated by the recipient's own notifyAnnouncementEmail — and stamps notifiedAt so a later
 * run never double-notifies the same post. Called by POST /api/cron/announcement-notifications,
 * meant to be hit every 10-15 minutes the same way the other reminder-style jobs already are —
 * see README's "Announcement notifications" section.
 */
export async function sendPendingAnnouncementNotifications(): Promise<AnnouncementNotificationResult> {
  const now = new Date();

  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const announcements = await tx.announcement.findMany({
      where: { publishDate: { lte: now }, notifiedAt: null },
      select: {
        id: true,
        title: true,
        audiences: { select: { departmentId: true, employeeId: true } },
      },
      orderBy: { publishDate: "asc" },
    });

    const failed: AnnouncementNotificationResult["failed"] = [];
    let notified = 0;
    let recipientsNotified = 0;

    for (const announcement of announcements) {
      try {
        const recipientIds = await resolveRecipientIds(tx, announcement.audiences);
        for (const recipientId of recipientIds) {
          await writeNotification(tx, {
            recipientId,
            type: "ANNOUNCEMENT_POSTED",
            title: `New announcement: ${announcement.title}`,
            body: `HR posted a new announcement: "${announcement.title}." Open the HR Portal to read the full post.`,
            targetType: "Announcement",
            targetId: announcement.id,
          });
          recipientsNotified++;
        }
        await tx.announcement.update({
          where: { id: announcement.id },
          data: { notifiedAt: new Date() },
        });
        notified++;
      } catch (err) {
        failed.push({
          announcementId: announcement.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { checked: announcements.length, notified, recipientsNotified, failed };
  });
}
