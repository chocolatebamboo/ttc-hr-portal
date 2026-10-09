import { withRlsContext } from "@/lib/db";
import { writeNotification } from "@/lib/notifications";
import { resolveTaskReviewerIds } from "@/lib/date-tasks";

/** CB, Oct 2026, round two: "we get some reminders to approve their tasks... I don't want them
 *  to forget." Doubles as both the delay before the FIRST reminder (a task has to have sat in
 *  AWAITING_REVIEW for this long since it was submitted) and the repeat cadence afterward (CB:
 *  "repeat daily until resolved") — one interval covers both, since "due for a reminder" is
 *  always just "the relevant timestamp is more than this long ago," whether that timestamp is
 *  submittedAt (never reminded yet) or lastReviewReminderAt (reminded before, due again). */
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Background actor for this job — same reasoning as every other SYSTEM_ACTOR in this codebase
 *  (clockout-reminders.ts, clockin-reminders.ts): no signed-in employee behind a scheduled run,
 *  and RLS's is_admin() only cares about app.current_role, not whether app.current_employee_id
 *  resolves to a real row. SUPER_ADMIN is what lets this job read every employee's DateTask rows
 *  and write a Notification to each reviewer (notification_insert's with-check is `true` — see
 *  writeNotification's own doc comment — but reading DateTask org-wide still needs is_admin()). */
const SYSTEM_ACTOR = { employeeId: "system:date-task-review-reminder", role: "SUPER_ADMIN" };

export interface DateTaskReviewReminderResult {
  checked: number;
  sent: number;
  failed: { taskId: string; error: string }[];
}

function nameOf(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

function formatWaiting(ms: number): string {
  const days = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
  return days === 1 ? "a day" : `${days} days`;
}

/**
 * The follow-up to submitDateTask's one-time DATE_TASK_SUBMITTED notification
 * (src/lib/date-tasks.ts): finds every DateTask still sitting in AWAITING_REVIEW whose
 * submittedAt (if never reminded) or lastReviewReminderAt (if reminded before) is at least
 * REMINDER_INTERVAL_MS old, re-notifies the exact same reviewers resolveTaskReviewerIds already
 * resolves for the original submit notification, and stamps lastReviewReminderAt so this same
 * task isn't picked up again until the interval has passed once more. A task that gets approved
 * or returned simply stops matching the `status: "AWAITING_REVIEW"` filter and the nagging stops
 * on its own — no separate "cancel the reminder" step needed anywhere else in the app.
 *
 * Called by POST /api/cron/date-task-reminders, meant to be hit every 15 minutes the same way
 * every other reminder-style job in this app already is (see README's "Task review reminders"
 * section and .github/workflows/reminder-emails.yml) — the 15-minute poll just means a task
 * becomes eligible sometime within the first 15 minutes after crossing the 24-hour mark, not
 * necessarily on the exact hour.
 */
export async function sendPendingDateTaskReviewReminders(): Promise<DateTaskReviewReminderResult> {
  const cutoff = new Date(Date.now() - REMINDER_INTERVAL_MS);

  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const tasks = await tx.dateTask.findMany({
      where: {
        status: "AWAITING_REVIEW",
        submittedAt: { lte: cutoff },
        OR: [{ lastReviewReminderAt: null }, { lastReviewReminderAt: { lte: cutoff } }],
      },
      select: {
        id: true,
        title: true,
        employeeId: true,
        submittedAt: true,
        employee: { select: { firstName: true, lastName: true, preferredName: true } },
      },
    });

    const failed: DateTaskReviewReminderResult["failed"] = [];
    let sent = 0;

    for (const task of tasks) {
      try {
        const reviewerIds = await resolveTaskReviewerIds(tx, task.employeeId);
        const waitingSince = task.submittedAt ?? new Date();
        const waitingFor = formatWaiting(Date.now() - waitingSince.getTime());
        for (const recipientId of reviewerIds) {
          await writeNotification(tx, {
            recipientId,
            type: "DATE_TASK_REVIEW_REMINDER",
            title: "Still waiting on your review",
            body: `${nameOf(task.employee)}'s task "${task.title}" has been awaiting review for ${waitingFor}.`,
            targetType: "DateTask",
            targetId: task.id,
          });
        }
        await tx.dateTask.update({ where: { id: task.id }, data: { lastReviewReminderAt: new Date() } });
        sent++;
      } catch (err) {
        failed.push({ taskId: task.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked: tasks.length, sent, failed };
  });
}
