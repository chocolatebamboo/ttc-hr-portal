import { withRlsContext } from "@/lib/db";
import { sendEmail } from "@/lib/email";

/** Background actor for this job — same reasoning as shift-reminders.ts/clockout-reminders.ts's
 *  own SYSTEM_ACTOR: there's no signed-in employee behind a scheduled run, and RLS's is_admin()
 *  only cares about app.current_role, not whether app.current_employee_id resolves to a real
 *  row. SUPER_ADMIN here is what lets this job read every recipient's Notification rows
 *  (notification_select in prisma/rls.sql), not just one person's. */
const SYSTEM_ACTOR = { employeeId: "system:notification-email", role: "SUPER_ADMIN" };

export interface NotificationEmailResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: { notificationId: string; error: string }[];
}

/** My Profile > Notifications (CB, Oct 2026) added two new NotificationType values
 *  (ANNOUNCEMENT_POSTED, MESSAGE_RECEIVED) that — unlike the 12 existing ones, which this job
 *  still emails unconditionally exactly as it always has — are gated on a per-recipient
 *  preference. Keyed by type rather than adding a 13th/14th special case inline, so a future
 *  preference-gated type is one more entry here, not another branch in the loop below. */
const PREFERENCE_BY_TYPE: Partial<Record<string, "notifyAnnouncementEmail" | "notifyMessageEmail">> = {
  ANNOUNCEMENT_POSTED: "notifyAnnouncementEmail",
  MESSAGE_RECEIVED: "notifyMessageEmail",
};

/**
 * CB, Sept 2026: "we need to make sure that any notification goes to their email as well so
 * they know." Every notification in this app already goes through writeNotification
 * (src/lib/notifications.ts) at one shared call site, so rather than teaching each of its
 * NotificationType call sites (src/lib/shifts.ts, availability.ts, pto-actions.ts, date-tasks.ts,
 * and — as of Oct 2026 — direct-messages.ts and announcement-notifications.ts) to also send its
 * own email, this job emails whatever writeNotification already wrote — same title/body text a
 * person sees in the in-app bell feed, reused as-is for the email subject/body (every call site
 * already writes title/body as a complete, standalone sentence, not a UI fragment, so nothing
 * needs rewording for email). The two Oct 2026 types are the only ones this job doesn't always
 * email — see PREFERENCE_BY_TYPE above.
 *
 * Deliberately async/batched here rather than sent inline from inside writeNotification's own
 * transaction: writeNotification runs INSIDE the same transaction as the real mutation it's a
 * side effect of (shift created, availability decided, etc. — see its own doc comment), and
 * blocking that transaction open on an external Resend HTTP call would reopen exactly the
 * connection-pool-exhaustion problem withConnectionLimit() in src/lib/db.ts was hotfixed for —
 * every authenticated request already holds its own transaction/connection for the call's
 * duration, and this app's whole Postgres pool is capped at 5. Same "find unsent rows, email
 * them, stamp a column so a later run doesn't double-send" shape shift-reminders.ts and
 * clockout-reminders.ts already use (their own AvailabilityShiftReminder row / reminderSentAt
 * column); Notification.emailedAt is this table's version of that same stamp (see its own doc
 * comment in prisma/schema.prisma). Called by POST /api/cron/notification-emails, meant to be
 * hit every 10-15 minutes the same way the other three reminder-style jobs already are — see
 * README's "Notification emails" section and .github/workflows/reminder-emails.yml.
 *
 * No lead-time window to check here (unlike shift-reminders' "within 30 minutes of start") —
 * a notification is already a completed event by the time writeNotification wrote it, so every
 * never-emailed row just needs sending, oldest first.
 */
export async function sendPendingNotificationEmails(): Promise<NotificationEmailResult> {
  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const notifications = await tx.notification.findMany({
      where: { emailedAt: null },
      orderBy: { createdAt: "asc" },
      include: {
        recipient: {
          select: {
            firstName: true,
            preferredName: true,
            ttcEmail: true,
            notifyAnnouncementEmail: true,
            notifyMessageEmail: true,
          },
        },
      },
    });

    const failed: NotificationEmailResult["failed"] = [];
    let sent = 0;
    let skipped = 0;

    for (const notification of notifications) {
      const preferenceField = PREFERENCE_BY_TYPE[notification.type];
      if (preferenceField && !notification.recipient[preferenceField]) {
        // Still in-app either way (writeNotification already wrote it) — just stamp emailedAt
        // so a later run doesn't keep re-checking a row this recipient opted out of emailing.
        await tx.notification.update({ where: { id: notification.id }, data: { emailedAt: new Date() } });
        skipped++;
        continue;
      }

      const name = notification.recipient.preferredName || notification.recipient.firstName;
      try {
        await sendEmail({
          to: notification.recipient.ttcEmail,
          subject: notification.title,
          text: notificationText(name, notification.title, notification.body),
          html: notificationHtml(name, notification.title, notification.body),
        });
        await tx.notification.update({
          where: { id: notification.id },
          data: { emailedAt: new Date() },
        });
        sent++;
      } catch (err) {
        failed.push({
          notificationId: notification.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { checked: notifications.length, sent, skipped, failed };
  });
}

function notificationText(name: string, title: string, body: string | null): string {
  return `Hi ${name},\n\n${title}${body ? `\n\n${body}` : ""}\n\nView it in the TTC HR Portal: https://hr.talentedteenclub.org\n\n— TTC HR Portal`;
}

function notificationHtml(name: string, title: string, body: string | null): string {
  return `<p>Hi ${name},</p><p><strong>${title}</strong></p>${body ? `<p>${body}</p>` : ""}<p><a href="https://hr.talentedteenclub.org">View it in the TTC HR Portal</a></p><p>— TTC HR Portal</p>`;
}
