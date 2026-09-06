import { withRlsContext } from "@/lib/db";
import { computeTotalMinutes } from "@/lib/time";

/**
 * CB, Sept 2026: "if you didn't clock out... it should automatically clock you out after, like,
 * I would say, three hours, four hours max. because I forgot to clock out last night, and it
 * went over twelve hours, and then it documented it to be twelve hours. I don't necessarily
 * want that because that's not necessarily true." Confirmed via follow-up: 4 hours, and the
 * recorded clockOut is cut off at exactly the cap (not "now") — the whole point is that letting
 * a forgotten session keep accumulating real elapsed time is what produced the wrong 12-hour
 * entry in the first place.
 */
const AUTO_CLOCKOUT_CAP_MS = 4 * 60 * 60 * 1000;

/** Background actor for this job — same placeholder-employeeId pattern as clockout-reminders.ts's
 *  SYSTEM_ACTOR, for the same reason: prisma/rls.sql's is_admin() (and every policy built on it,
 *  including time_entry_write_own/time_session_write/time_audit_insert) keys off
 *  app.current_role alone, not whether app.current_employee_id resolves to a real row. Unlike
 *  clockout-reminders.ts, this job also writes a TimeEntryAuditEvent — that's what actorId being
 *  nullable on that model (see the 20260906_auto_clockout migration) is for: this SYSTEM_ACTOR is
 *  only ever used for the RLS context, never as the audit event's own actorId. */
const SYSTEM_ACTOR = { employeeId: "system:auto-clockout", role: "SUPER_ADMIN" };

export interface AutoClockoutResult {
  checked: number;
  closed: { sessionId: string; timeEntryId: string; clockIn: string; clockOut: string }[];
  failed: { sessionId: string; error: string }[];
}

/**
 * Finds every open (no clockOut) TimeSession that's been running at least AUTO_CLOCKOUT_CAP_MS,
 * force-closes it at exactly clockIn + cap (never "now" — see the doc comment above), recomputes
 * the parent TimeEntry's totalMinutes, and puts that entry into AWAITING_APPROVAL so a supervisor
 * sees it needs a look — same status applyClockAction already uses for any ordinary clock-out,
 * reused here rather than inventing a separate "auto-closed" TimeEntry status, per CB's
 * "flagged for review" answer. A TimeEntryAuditEvent with the new AUTO_CLOCK_OUT action and no
 * actor records *why* the clockOut doesn't match what the team member would have entered
 * themselves, so it's visibly different from a normal clock-out in the audit trail HR already
 * has (ReviewTimesheetView, etc.) rather than looking like an ordinary self-reported day.
 *
 * Called by POST /api/cron/auto-clockout, on the same 15-minute GitHub Actions schedule as the
 * clock-out reminder and shift reminder jobs (see README's "Auto clock-out" section) — a session
 * is checked here well before 4 hours has genuinely passed, since it also needs to catch the
 * exact run where the cap is crossed.
 */
export async function autoCloseStaleClockIns(): Promise<AutoClockoutResult> {
  const cutoff = new Date(Date.now() - AUTO_CLOCKOUT_CAP_MS);

  return withRlsContext(SYSTEM_ACTOR, async (tx) => {
    const sessions = await tx.timeSession.findMany({
      where: { clockOut: null, clockIn: { lte: cutoff } },
      select: { id: true, clockIn: true, timeEntryId: true },
    });

    const closed: AutoClockoutResult["closed"] = [];
    const failed: AutoClockoutResult["failed"] = [];

    for (const session of sessions) {
      try {
        const cappedClockOut = new Date(session.clockIn.getTime() + AUTO_CLOCKOUT_CAP_MS);

        await tx.timeSession.update({
          where: { id: session.id },
          data: { clockOut: cappedClockOut },
        });

        const siblingSessions = await tx.timeSession.findMany({
          where: { timeEntryId: session.timeEntryId },
          select: { clockIn: true, clockOut: true },
        });
        const totalMinutes = computeTotalMinutes(siblingSessions);

        await tx.timeEntry.update({
          where: { id: session.timeEntryId },
          data: { totalMinutes, status: "AWAITING_APPROVAL" },
        });

        await tx.timeEntryAuditEvent.create({
          data: {
            timeEntryId: session.timeEntryId,
            action: "AUTO_CLOCK_OUT",
            fieldName: "clockOut",
            newValue: cappedClockOut.toISOString(),
            comment: `Automatically clocked out after being open ${AUTO_CLOCKOUT_CAP_MS / 3_600_000} hours — flagged for review.`,
          },
        });

        closed.push({
          sessionId: session.id,
          timeEntryId: session.timeEntryId,
          clockIn: session.clockIn.toISOString(),
          clockOut: cappedClockOut.toISOString(),
        });
      } catch (err) {
        failed.push({ sessionId: session.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked: sessions.length, closed, failed };
  });
}
