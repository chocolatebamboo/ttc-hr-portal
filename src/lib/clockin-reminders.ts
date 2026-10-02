import { withRlsContext } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { formatTime12h } from "@/lib/availability-format";
import { orgNow, timeToMinutes } from "@/lib/time";

/** Replaces shift-reminders.ts (retired in this same delivery) — same "nudge 0-30 minutes before
 *  start" behavior CB asked for, now keyed on the Shift model (this app's real source of
 *  scheduling truth) instead of the older AvailabilitySubmission.slots JSON. convert-to-shift
 *  never cleared the submission's own APPROVED status, so a converted shift could get BOTH the
 *  old reminder and this one — see this column's own doc comment in prisma/schema.prisma. */
const REMINDER_LEAD_MINUTES = 30;

/** Background actor for this job — same reasoning as every other SYSTEM_ACTOR in this codebase
 *  (clockout-reminders.ts, the old shift-reminders.ts): no signed-in employee behind a scheduled
 *  run, and RLS's is_admin() only cares about app.current_role, not whether
 *  app.current_employee_id resolves to a real row. SUPER_ADMIN is what lets this job read/write
 *  every employee's own Shift rows via shift_write's is_admin() branch (prisma/rls.sql). */
const SYSTEM_ACTOR = { employeeId: "system:clockin-reminder", role: "SUPER_ADMIN" };

export interface ClockinReminderResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: { shiftId: string; error: string }[];
}

/**
 * My Profile > Notifications (CB, Oct 2026): "I kind of want... by default... email sent to
 * them, reminding them that it's time to clock in." Finds every UPCOMING Shift dated today (in
 * ORG_TIMEZONE) whose start time is 0-30 minutes away, hasn't already gotten a reminder, and
 * belongs to an employee who still has notifyClockInEmail on — emails them, and stamps
 * clockInReminderSentAt so a later run in the same window doesn't send a second one. Called by
 * POST /api/cron/clockin-reminders, meant to be hit every 10-15 minutes the same way the other
 * reminder-style jobs already are — see README's "Clock-in reminders" section.
 *
 * Shifts are fetched by date+status (both indexed — see @@index([employeeId, date]) and
 * @@index([status]) on Shift) rather than filtering startTime in the query itself, same reason
 * the old shift-reminders.ts checked its own time window in application code: this app's actual
 * shift volume per day is small, so one query plus an in-memory minutes-until-start check is
 * simpler than a raw time-arithmetic WHERE clause.
 */
export async function sendPendingClockinReminders(): Promise<ClockinReminderResult> {
  const { dateKey: today, minutesSinceMidnight: nowMinutes } = orgNow();

  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const shifts = await tx.shift.findMany({
      where: {
        date: today,
        status: "UPCOMING",
        clockInReminderSentAt: null,
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        employee: {
          select: {
            firstName: true,
            preferredName: true,
            ttcEmail: true,
            notifyClockInEmail: true,
          },
        },
      },
    });

    const failed: ClockinReminderResult["failed"] = [];
    let checked = 0;
    let sent = 0;
    let skipped = 0;

    for (const shift of shifts) {
      const minutesUntilStart = timeToMinutes(shift.startTime) - nowMinutes;
      // Same window reasoning as the old shift-reminders.ts: negative means the shift already
      // started (this run missed its window — better to stay quiet than claim a start time
      // that's already past), and this cron runs often enough that a positive value should
      // rarely exceed the lead time by much.
      if (minutesUntilStart < 0 || minutesUntilStart > REMINDER_LEAD_MINUTES) continue;

      checked++;
      if (!shift.employee.notifyClockInEmail) {
        // Stamped either way, same as clockout-reminders.ts/notification-emails.ts's own
        // preference skips — otherwise this shift gets re-checked (and re-skipped) on every
        // run for the rest of its 30-minute window instead of just once.
        await tx.shift.update({ where: { id: shift.id }, data: { clockInReminderSentAt: new Date() } });
        skipped++;
        continue;
      }

      const employee = shift.employee;
      const name = employee.preferredName || employee.firstName;
      try {
        await sendEmail({
          to: employee.ttcEmail,
          subject: `Your shift starts at ${formatTime12h(shift.startTime)} today`,
          text: reminderText(name, shift.startTime, shift.endTime),
          html: reminderHtml(name, shift.startTime, shift.endTime),
        });
        await tx.shift.update({
          where: { id: shift.id },
          data: { clockInReminderSentAt: new Date() },
        });
        sent++;
      } catch (err) {
        failed.push({ shiftId: shift.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked, sent, skipped, failed };
  });
}

function reminderText(name: string, startTime: string, endTime: string): string {
  return `Hi ${name},\n\nJust a heads-up: your shift today starts at ${formatTime12h(startTime)} (ends ${formatTime12h(endTime)}). Don't forget to clock in when you get there.\n\n— TTC HR Portal`;
}

function reminderHtml(name: string, startTime: string, endTime: string): string {
  return `<p>Hi ${name},</p><p>Just a heads-up: your shift today starts at <strong>${formatTime12h(startTime)}</strong> (ends ${formatTime12h(endTime)}). Don't forget to clock in when you get there.</p><p>— TTC HR Portal</p>`;
}
