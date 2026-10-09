import { withRlsContext } from "@/lib/db";
import { computeTotalMinutes, zonedDateTimeToUtc } from "@/lib/time";

/**
 * CB, Sept 2026: "if you didn't clock out... it should automatically clock you out after, like,
 * I would say, three hours, four hours max. because I forgot to clock out last night, and it
 * went over twelve hours, and then it documented it to be twelve hours. I don't necessarily
 * want that because that's not necessarily true." Confirmed via follow-up: 4 hours — this stays
 * the outer safety cap (see autoCloseStaleClockIns's own doc comment below for what actually
 * gets recorded most of the time now) so a forgotten session can never again balloon into a
 * wrong 12-hour entry no matter what the schedule says.
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
 * Finds every open (no clockOut) TimeSession that's been running at least AUTO_CLOCKOUT_CAP_MS
 * and force-closes it — never at "now" (see the doc comment above), and, as of Oct 2026, not
 * reflexively at clockIn + cap either. CB, on a clean clock-in that just ran past the scheduled
 * end time because the team member forgot to clock out: "doesn't it cut off based off of the
 * schedule that was agreed upon?... it just records the time that they were scheduled [to clock
 * out]." So when this session matched a shift at clock-in (TimeSession.shiftId — see
 * resolveClockInShift in src/lib/time-actions.ts) and that shift's own scheduled end time falls
 * before the 4-hour cap, THAT'S what gets recorded as the clockOut — the 4-hour cap only ever
 * kicks in as the fallback: no shift was matched at all, or the shift runs longer than 4 hours
 * anyway. Either way the recorded time is never later than clockIn + AUTO_CLOCKOUT_CAP_MS, so a
 * forgotten clock-out still can't balloon into the wrong 12-hour entry this cap exists to
 * prevent.
 *
 * Whether the day still needs a supervisor's look follows the same shape as applyClockAction's
 * own auto-approve check (src/lib/time-actions.ts, "every session this day matched an
 * already-approved shift, on time, with nothing flagged"): a session closed cleanly against its
 * own schedule, with nothing already flagged about its clock-in, is left isException: false —
 * invisible as anything out of the ordinary, same as a normal on-time clock-out — and if that
 * leaves nothing flagged anywhere else in the day either, the whole entry goes straight to
 * APPROVED with its own TIMESHEET_AUTO_APPROVED audit row, exactly like a clean manual clock-out
 * already does. Anything less certain (no shift matched, the shift ran past the 4-hour cap so
 * the fallback had to be used, or the clock-in itself was already flagged) is marked
 * isException: true with a reason explaining why, which both shows a "Flagged: ..." chip right
 * on the timesheet (TimesheetTable already renders any isException session that way) and makes
 * applyClockAction's own auto-approve check correctly refuse to wave through a later same-day
 * reopen as "clean." A TimeEntryAuditEvent with the AUTO_CLOCK_OUT action and no actor is always
 * written regardless, so the audit trail HR already has (ReviewTimesheetView, etc.) can always
 * show *why* a clockOut doesn't match what the team member would have entered themselves, even
 * on a day that needed no review at all.
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
      select: { id: true, clockIn: true, timeEntryId: true, shiftId: true, isException: true, exceptionReason: true },
    });

    const closed: AutoClockoutResult["closed"] = [];
    const failed: AutoClockoutResult["failed"] = [];

    for (const session of sessions) {
      try {
        const capTime = new Date(session.clockIn.getTime() + AUTO_CLOCKOUT_CAP_MS);

        const shift = session.shiftId
          ? await tx.shift.findUnique({ where: { id: session.shiftId }, select: { date: true, endTime: true } })
          : null;
        const scheduledEnd = shift ? zonedDateTimeToUtc(shift.date, shift.endTime) : null;
        const usedSchedule = !!scheduledEnd && scheduledEnd > session.clockIn && scheduledEnd <= capTime;
        const clockOut = usedSchedule ? scheduledEnd! : capTime;

        const alreadyFlagged = session.isException;
        const cleanClose = usedSchedule && !alreadyFlagged;

        const autoCloseNote = usedSchedule
          ? "Automatically clocked out at the end of their scheduled shift — forgot to clock out."
          : shift
            ? `Automatically clocked out after being open ${AUTO_CLOCKOUT_CAP_MS / 3_600_000} hours — their scheduled shift runs longer than that.`
            : `Automatically clocked out after being open ${AUTO_CLOCKOUT_CAP_MS / 3_600_000} hours — no scheduled shift to go by.`;
        const newExceptionReason = cleanClose
          ? null
          : alreadyFlagged && session.exceptionReason
            ? `${session.exceptionReason} ${autoCloseNote}`
            : autoCloseNote;

        await tx.timeSession.update({
          where: { id: session.id },
          data: {
            clockOut,
            isException: !cleanClose,
            exceptionReason: newExceptionReason,
          },
        });

        const siblingSessions = await tx.timeSession.findMany({
          where: { timeEntryId: session.timeEntryId },
          select: { clockIn: true, clockOut: true, isException: true },
        });
        const totalMinutes = computeTotalMinutes(siblingSessions);
        const hasException = siblingSessions.some((s) => s.isException);
        const entryStatus = hasException ? "AWAITING_APPROVAL" : "APPROVED";

        await tx.timeEntry.update({
          where: { id: session.timeEntryId },
          data: { totalMinutes, status: entryStatus },
        });

        await tx.timeEntryAuditEvent.create({
          data: {
            timeEntryId: session.timeEntryId,
            action: "AUTO_CLOCK_OUT",
            fieldName: "clockOut",
            newValue: clockOut.toISOString(),
            comment: cleanClose ? `${autoCloseNote} Nothing else about the day was flagged, so no review needed.` : `${autoCloseNote} Flagged for review.`,
          },
        });

        if (entryStatus === "APPROVED") {
          await tx.timeEntryAuditEvent.create({
            data: {
              timeEntryId: session.timeEntryId,
              action: "TIMESHEET_AUTO_APPROVED",
              comment: "Automatically approved — every punch matched an already-approved shift, on time, with nothing flagged.",
            },
          });
        }

        closed.push({
          sessionId: session.id,
          timeEntryId: session.timeEntryId,
          clockIn: session.clockIn.toISOString(),
          clockOut: clockOut.toISOString(),
        });
      } catch (err) {
        failed.push({ sessionId: session.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked: sessions.length, closed, failed };
  });
}
