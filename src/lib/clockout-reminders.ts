import { withRlsContext } from "@/lib/db";
import { sendEmail } from "@/lib/email";

/** CB: "after three hours... should get a notification to remind them to clock out" — the
 *  schedule doesn't run much past 3-4 hours normally, so a session still open at 3h is worth
 *  flagging. This is a one-time nudge per open session, not a recurring escalation. */
const REMINDER_THRESHOLD_MS = 3 * 60 * 60 * 1000;

/** Background actor for this job — there's no signed-in employee behind a scheduled run, so
 *  this employeeId is a placeholder that matches no real row. That's fine: prisma/rls.sql's
 *  is_admin() (and every policy built on it) keys off app.current_role alone, not whether
 *  app.current_employee_id resolves to something real — see src/lib/db.ts. */
const SYSTEM_ACTOR = { employeeId: "system:clockout-reminder", role: "SUPER_ADMIN" };

export interface ClockoutReminderResult {
  checked: number;
  sent: number;
  failed: { sessionId: string; error: string }[];
}

/**
 * Finds every open (no clockOut) TimeSession that's been running at least REMINDER_THRESHOLD_MS
 * and hasn't already gotten a reminder, emails the employee, and marks the session so a later
 * run doesn't send a second one for it. Called by POST /api/cron/clockout-reminders, which a
 * Render Cron Job hits on a schedule — see README's "Clock-out reminders" section.
 */
export async function sendPendingClockoutReminders(): Promise<ClockoutReminderResult> {
  const cutoff = new Date(Date.now() - REMINDER_THRESHOLD_MS);

  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const sessions = await tx.timeSession.findMany({
      where: {
        clockOut: null,
        reminderSentAt: null,
        clockIn: { lte: cutoff },
      },
      select: {
        id: true,
        clockIn: true,
        timeEntry: {
          select: {
            employee: {
              select: { firstName: true, preferredName: true, ttcEmail: true },
            },
          },
        },
      },
    });

    const failed: ClockoutReminderResult["failed"] = [];
    let sent = 0;

    for (const session of sessions) {
      const employee = session.timeEntry.employee;
      const name = employee.preferredName || employee.firstName;
      try {
        await sendEmail({
          to: employee.ttcEmail,
          subject: "Reminder: you're still clocked in",
          text: reminderText(name, session.clockIn),
          html: reminderHtml(name, session.clockIn),
        });
        await tx.timeSession.update({
          where: { id: session.id },
          data: { reminderSentAt: new Date() },
        });
        sent++;
      } catch (err) {
        failed.push({ sessionId: session.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked: sessions.length, sent, failed };
  });
}

function reminderText(name: string, clockIn: Date): string {
  const time = clockIn.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Hi ${name},\n\nYou clocked in at ${time} and it's been over 3 hours — this is just a reminder in case you forgot to clock out. If you're still working, there's nothing to do.\n\n— TTC HR Portal`;
}

function reminderHtml(name: string, clockIn: Date): string {
  const time = clockIn.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `<p>Hi ${name},</p><p>You clocked in at <strong>${time}</strong> and it's been over 3 hours — this is just a reminder in case you forgot to clock out. If you're still working, there's nothing to do.</p><p>— TTC HR Portal</p>`;
}
