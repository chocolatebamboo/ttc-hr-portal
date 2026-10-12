import { withRlsContext } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { formatSlotDate } from "@/lib/availability-format";
import { orgNow } from "@/lib/time";

/** Background actor for this job — same reasoning as every other SYSTEM_ACTOR in this codebase
 *  (clockin-reminders.ts, clockout-reminders.ts): no signed-in employee behind a scheduled run,
 *  and RLS's is_admin() only cares about app.current_role, not whether app.current_employee_id
 *  resolves to a real row. */
const SYSTEM_ACTOR = { employeeId: "system:availability-cutoff-reminder", role: "SUPER_ADMIN" };

export interface AvailabilityCutoffReminderResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: { employeeId: string; error: string }[];
}

/** `dateKey` + `days` (negative for the past), via UTC-anchored arithmetic on the parsed
 *  components rather than a timezone-sensitive `Date` — same reasoning dateKeyDaysFromNow (src/
 *  lib/time.ts) gives for its own local version of this, just done here in a way that's safe to
 *  call with a server-resolved ORG_TIMEZONE date key instead of the browser's local one. */
function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 0 = Sunday .. 6 = Saturday, for a "YYYY-MM-DD" date key — same UTC-anchored trick as
 *  addDaysToDateKey above, so this reads the calendar date the key actually names rather than
 *  whatever day it'd be in the server process's own timezone. */
function weekdayForDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * My Profile > Notifications (CB, Oct 2026, following up on the in-app "submit your availability
 * for next week" banner: "we're supposed to send out that reminder to make their schedule on
 * Sunday... I want to make sure that's working properly"): that banner (AvailabilityView.tsx's
 * showCutoffReminder) only ever showed up Thursday through Saturday to someone who happened to
 * have the Availability page open — it never reached anyone who didn't. This is the email
 * counterpart, same Thursday-through-Saturday window and same "has this person submitted
 * anything covering next week yet" check, just run server-side against every active employee
 * instead of client-side against whoever's currently looking at the page.
 *
 * One email per employee per upcoming week, sent on whichever Thu/Fri/Sat run first catches them
 * still missing it — same one-shot-per-thing philosophy as every other reminder in this codebase
 * (clockin-reminders.ts, clockout-reminders.ts), not a repeating daily nag. Dedup is
 * Employee.lastAvailabilityCutoffReminderWeek (the upcoming week's own Sunday date key) rather
 * than a timestamp, since there's no per-week row to stamp one on — see that column's own doc
 * comment in prisma/schema.prisma.
 *
 * Called by POST /api/cron/availability-cutoff-reminders, meant to be hit every 15 minutes the
 * same way every other reminder-style job already is — see README's "Availability cutoff
 * reminders" section. Running it off-window (any day other than Thu/Fri/Sat, in ORG_TIMEZONE) is
 * a cheap no-op, so there's no harm in it sharing the same 15-minute schedule as everything else
 * rather than needing its own.
 */
export async function sendPendingAvailabilityCutoffReminders(): Promise<AvailabilityCutoffReminderResult> {
  const { dateKey: today } = orgNow();
  const weekday = weekdayForDateKey(today);

  // Same Thursday-through-Saturday window as the in-app banner — see that component's own doc
  // comment for why Sunday itself is excluded (the reminder's moot by then, the cutoff's already
  // arrived) and why it starts Thursday rather than running all week.
  if (![4, 5, 6].includes(weekday)) {
    return { checked: 0, sent: 0, skipped: 0, failed: [] };
  }

  // "Next week" = the Sunday-start week after whichever one `today` falls in — same boundary
  // AvailabilityView's own hasSubmittedNextWeek uses client-side, just computed off ORG_TIMEZONE
  // rather than a browser's local clock, since this runs on a server with no browser clock of
  // its own. `weekday` is already "how many days into this Sunday-start week today is."
  const thisWeekStart = addDaysToDateKey(today, -weekday);
  const nextWeekStart = addDaysToDateKey(thisWeekStart, 7);
  const nextWeekEnd = addDaysToDateKey(nextWeekStart, 6);

  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const employees = await tx.employee.findMany({
      where: {
        deactivatedAt: null,
        notifyAvailabilityCutoffEmail: true,
        // Either never reminded about a week yet, or the last week they were reminded about
        // isn't THIS upcoming one — covers both "never sent" and "sent for a prior week, this
        // is a new one now."
        lastAvailabilityCutoffReminderWeek: { not: nextWeekStart },
      },
      select: {
        id: true,
        firstName: true,
        preferredName: true,
        ttcEmail: true,
        availabilitySubmissions: {
          where: { status: { not: "CANCELLED" } },
          select: { slots: true },
        },
      },
    });

    const failed: AvailabilityCutoffReminderResult["failed"] = [];
    let checked = 0;
    let sent = 0;
    let skipped = 0;

    for (const employee of employees) {
      checked++;

      // Same "any non-cancelled submission with a slot date inside the window" test
      // hasSubmittedNextWeek runs client-side — a submission can cover any set of dates, so this
      // only needs ONE of them to fall in next week's range for that week to count as covered.
      const hasSubmittedNextWeek = employee.availabilitySubmissions.some((s) => {
        const slots = s.slots as { date: string }[];
        return slots.some((slot) => slot.date >= nextWeekStart && slot.date <= nextWeekEnd);
      });

      if (hasSubmittedNextWeek) {
        // Stamped either way, same as every other reminder job's own preference/already-covered
        // skip — otherwise this person gets re-checked (and re-skipped) on every run for the
        // rest of this week's Thu-Sat window instead of just once.
        await tx.employee.update({
          where: { id: employee.id },
          data: { lastAvailabilityCutoffReminderWeek: nextWeekStart },
        });
        skipped++;
        continue;
      }

      const name = employee.preferredName || employee.firstName;
      try {
        await sendEmail({
          to: employee.ttcEmail,
          subject: "Submit your availability for next week",
          text: reminderText(name, nextWeekStart, nextWeekEnd),
          html: reminderHtml(name, nextWeekStart, nextWeekEnd),
        });
        await tx.employee.update({
          where: { id: employee.id },
          data: { lastAvailabilityCutoffReminderWeek: nextWeekStart },
        });
        sent++;
      } catch (err) {
        failed.push({ employeeId: employee.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked, sent, skipped, failed };
  });
}

function reminderText(name: string, weekStart: string, weekEnd: string): string {
  return `Hi ${name},\n\nJust a heads-up: you haven't submitted your availability for next week yet (${formatSlotDate(weekStart)} – ${formatSlotDate(weekEnd)}). Submit it by Sunday so your supervisor or HR has time to review and schedule it.\n\n— TTC HR Portal`;
}

function reminderHtml(name: string, weekStart: string, weekEnd: string): string {
  return `<p>Hi ${name},</p><p>Just a heads-up: you haven't submitted your availability for next week yet (<strong>${formatSlotDate(weekStart)} – ${formatSlotDate(weekEnd)}</strong>). Submit it by Sunday so your supervisor or HR has time to review and schedule it.</p><p>— TTC HR Portal</p>`;
}
