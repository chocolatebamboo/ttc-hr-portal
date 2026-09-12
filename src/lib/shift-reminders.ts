import { withRlsContext } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { formatTime12h } from "@/lib/availability-format";
import { orgNow, timeToMinutes } from "@/lib/time";
import type { AvailabilitySlot } from "@/types";

/** CB, Sept 2026: "once they pick out their availability and it's confirmed [approved]...
 *  set a reminder... thirty minutes before they clock in." Only ever sends once someone's
 *  within this many minutes of the slot's own start time (see sendPendingShiftReminders below)
 *  — not a repeating nudge, same one-shot-per-thing philosophy as clockout-reminders.ts. */
const REMINDER_LEAD_MINUTES = 30;

/** Background actor for this job — same reasoning as clockout-reminders.ts's SYSTEM_ACTOR:
 *  there's no signed-in employee behind a scheduled run, and RLS's is_admin() only cares about
 *  app.current_role, not whether app.current_employee_id resolves to a real row. */
const SYSTEM_ACTOR = { employeeId: "system:shift-reminder", role: "SUPER_ADMIN" };

export interface ShiftReminderResult {
  checked: number;
  sent: number;
  failed: { submissionId: string; date: string; error: string }[];
}

/**
 * Finds every APPROVED AvailabilitySubmission with a slot dated today (in ORG_TIMEZONE) whose
 * start time is 0-30 minutes away and hasn't already gotten a reminder for that date, emails
 * the employee, and records an AvailabilityShiftReminder row so a later run in the same window
 * doesn't send a second one. Called by POST /api/cron/shift-reminders, meant to be hit every
 * 10-15 minutes the same way /api/cron/clockout-reminders already is — see README.
 *
 * Submissions are fetched by status alone (an indexed column) and filtered against `slots`
 * (JSON) in application code rather than in the query itself — same reason
 * src/lib/availability.ts never queries slots server-side either: at this app's actual scale,
 * fetching every approved submission and checking a handful of dates in memory is simpler and
 * plenty fast, and avoids a raw/unsafe JSON-containment query for what's normally a small list.
 */
export async function sendPendingShiftReminders(): Promise<ShiftReminderResult> {
  const { dateKey: today, minutesSinceMidnight: nowMinutes } = orgNow();

  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const submissions = await tx.availabilitySubmission.findMany({
      where: { status: "APPROVED" },
      select: {
        id: true,
        slots: true,
        employee: { select: { firstName: true, preferredName: true, ttcEmail: true } },
        shiftReminders: { where: { date: today }, select: { date: true } },
      },
    });

    const failed: ShiftReminderResult["failed"] = [];
    let checked = 0;
    let sent = 0;

    for (const submission of submissions) {
      if (submission.shiftReminders.length > 0) continue; // already sent for today's date

      const slots = submission.slots as unknown as AvailabilitySlot[];
      const todaysSlot = slots.find((s) => s.date === today);
      if (!todaysSlot) continue;

      checked++;
      const minutesUntilStart = timeToMinutes(todaysSlot.startTime) - nowMinutes;
      // Only the window from "now" up to REMINDER_LEAD_MINUTES ahead — a negative value means
      // the shift already started (the cron missed its window; better to stay quiet than send
      // a reminder claiming the shift starts in the past) and this cron is expected to run
      // often enough that a positive value should rarely exceed the lead time by much.
      if (minutesUntilStart < 0 || minutesUntilStart > REMINDER_LEAD_MINUTES) continue;

      const employee = submission.employee;
      const name = employee.preferredName || employee.firstName;
      try {
        await sendEmail({
          to: employee.ttcEmail,
          subject: "Reminder: your shift starts soon",
          text: reminderText(name, todaysSlot),
          html: reminderHtml(name, todaysSlot),
        });
        await tx.availabilityShiftReminder.create({
          data: { submissionId: submission.id, date: today },
        });
        sent++;
      } catch (err) {
        failed.push({ submissionId: submission.id, date: today, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked, sent, failed };
  });
}

function reminderText(name: string, slot: AvailabilitySlot): string {
  return `Hi ${name},\n\nJust a heads-up: your shift today starts at ${formatTime12h(slot.startTime)} (ends ${formatTime12h(slot.endTime)}). This is a one-time reminder — no action needed.\n\n— TTC HR Portal`;
}

function reminderHtml(name: string, slot: AvailabilitySlot): string {
  return `<p>Hi ${name},</p><p>Just a heads-up: your shift today starts at <strong>${formatTime12h(slot.startTime)}</strong> (ends ${formatTime12h(slot.endTime)}). This is a one-time reminder — no action needed.</p><p>— TTC HR Portal</p>`;
}
