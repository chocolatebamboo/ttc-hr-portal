import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { CLOCK_IN_WINDOW_MINUTES, computeTotalMinutes, orgNow, timeToMinutes, todayDateKey, zonedDateTimeToUtc } from "@/lib/time";
import type { CurrentEmployee, TimeClockState } from "@/types";

export class InvalidClockActionError extends Error {
  constructor(action: "CLOCK_IN" | "CLOCK_OUT", currentState: TimeClockState) {
    const readable =
      currentState === "CLOCKED_IN" ? "already clocked in" : currentState === "CLOCKED_OUT" ? "clocked out" : "not clocked in yet";
    const verb = action === "CLOCK_IN" ? "clock in" : "clock out";
    super(`Can't ${verb} — you're ${readable}.`);
    this.name = "InvalidClockActionError";
  }
}

/** Phase 3 (client spec, Sept 2026): thrown when a clock-in falls outside the window (or has
 *  no scheduled shift at all) and no reason was given for it — see resolveClockInShift below.
 *  Never thrown for clock-out (gating is clock-in only). */
export class MissingExceptionReasonError extends Error {
  constructor(reasonPromptKind: "no_shift" | "outside_window") {
    super(
      reasonPromptKind === "no_shift"
        ? "You don't have a shift scheduled today — add a quick reason for clocking in."
        : "This is outside your scheduled shift's start time — add a quick reason for clocking in."
    );
    this.name = "MissingExceptionReasonError";
  }
}

type ClockAction = "CLOCK_IN" | "CLOCK_OUT";

/** What CLOCK_IN would match against right now, if anything — shared by getClockInStatus (the
 *  UI's before-the-click preview) and applyClockAction itself (the real, authoritative check),
 *  so the two can never disagree about what counts as on-time. Picks whichever of today's live
 *  shifts (UPCOMING, or already mid-request — CHANGE_REQUESTED/CANCELLATION_REQUESTED, still
 *  actually happening until a supervisor decides otherwise) has a startTime closest to right
 *  now, in case there's ever more than one in a day; CANCELLED/REASSIGNED shifts never match —
 *  there's nothing left for this employee to actually show up for. */
async function resolveClockInShift(
  tx: PrismaClient,
  employeeId: string
): Promise<{ shiftId: string; date: string; startTime: string; endTime: string; withinWindow: boolean } | null> {
  const { dateKey: today, minutesSinceMidnight: nowMinutes } = orgNow();
  const candidates = await tx.shift.findMany({
    where: { employeeId, date: today, status: { in: ["UPCOMING", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"] } },
    select: { id: true, date: true, startTime: true, endTime: true },
  });
  if (candidates.length === 0) return null;

  const nearest = candidates.reduce((best, s) =>
    Math.abs(timeToMinutes(s.startTime) - nowMinutes) < Math.abs(timeToMinutes(best.startTime) - nowMinutes) ? s : best
  );
  const withinWindow = Math.abs(timeToMinutes(nearest.startTime) - nowMinutes) <= CLOCK_IN_WINDOW_MINUTES;
  return { shiftId: nearest.id, date: nearest.date, startTime: nearest.startTime, endTime: nearest.endTime, withinWindow };
}

/** The employee's own before-the-click preview of what clocking in right now would do — lets
 *  TimeClockCard show a reason field proactively instead of only finding out after a rejected
 *  POST. Read-only; never used to actually decide anything on its own (applyClockAction below
 *  re-resolves the same thing at the moment of the real action, since "right now" can move
 *  between the two calls). */
export async function getClockInStatus(actor: CurrentEmployee): Promise<{
  requiresReason: boolean;
  reasonPromptKind: "no_shift" | "outside_window" | null;
  shift: { date: string; startTime: string; endTime: string } | null;
}> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const match = await resolveClockInShift(tx, actor.id);
    if (!match) return { requiresReason: true, reasonPromptKind: "no_shift", shift: null };
    const shift = { date: match.date, startTime: match.startTime, endTime: match.endTime };
    return match.withinWindow
      ? { requiresReason: false, reasonPromptKind: null, shift }
      : { requiresReason: true, reasonPromptKind: "outside_window", shift };
  });
}

/**
 * The one function every time-clock API route calls. Re-derives the current state from the
 * database (never trusts what the client thinks the state is) and rejects anything but the
 * single legal next action: Clock In only while there's no open session, Clock Out only while
 * there is one. Any number of clock-in/clock-out pairs are allowed per day now — no lunch step,
 * no cap — so this is deliberately just two states rather than the old four-stage flow.
 *
 * `reason` is only ever read for CLOCK_IN, and only matters when it turns out to be an
 * exception (see resolveClockInShift above) — required in that case (MissingExceptionReasonError
 * otherwise), ignored entirely for an on-time clock-in so an extra typed note never gets treated
 * as anything other than what it is.
 */
export async function applyClockAction(actor: CurrentEmployee, action: ClockAction, reason?: string) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const workDate = new Date(`${todayDateKey()}T00:00:00.000Z`);
    const now = new Date();

    let entry = await tx.timeEntry.findUnique({
      where: { employeeId_workDate: { employeeId: actor.id, workDate } },
      include: { sessions: true },
    });

    const openSession = entry?.sessions.find((s) => s.clockOut === null) ?? null;

    if (action === "CLOCK_IN" && openSession) {
      throw new InvalidClockActionError("CLOCK_IN", "CLOCKED_IN");
    }
    if (action === "CLOCK_OUT" && !openSession) {
      throw new InvalidClockActionError("CLOCK_OUT", entry ? "CLOCKED_OUT" : "BEFORE_WORK");
    }

    let createdNew = false;
    if (!entry) {
      entry = await tx.timeEntry.create({
        data: { employeeId: actor.id, workDate, status: "IN_PROGRESS" },
        include: { sessions: true },
      });
      createdNew = true;
    }

    // Phase 3 (client spec, Sept 2026): "clock-in gated to scheduled shifts with a 15-minute
    // window and exception-reason flagging" — resolved fresh here (not trusted from
    // getClockInStatus's earlier preview) since "right now" can move between the two calls.
    // CB confirmed: never blocks the clock-in outright, and never applies to CLOCK_OUT at all —
    // an exception still gets recorded and paid, just flagged with its own reason for whoever
    // reviews the timesheet.
    let exceptionComment: string | undefined;
    if (action === "CLOCK_IN") {
      const match = await resolveClockInShift(tx, actor.id);
      const isException = !match || !match.withinWindow;
      const trimmedReason = reason?.trim();
      if (isException && !trimmedReason) {
        throw new MissingExceptionReasonError(match ? "outside_window" : "no_shift");
      }
      exceptionComment = isException ? trimmedReason : undefined;
      await tx.timeSession.create({
        data: {
          timeEntryId: entry.id,
          clockIn: now,
          shiftId: match?.shiftId ?? null,
          isException,
          exceptionReason: isException ? trimmedReason! : null,
        },
      });
    } else {
      await tx.timeSession.update({ where: { id: openSession!.id }, data: { clockOut: now } });
    }

    if (createdNew) {
      await tx.timeEntryAuditEvent.create({
        data: { timeEntryId: entry.id, action: "ENTRY_CREATED", actorId: actor.id },
      });
    }
    await tx.timeEntryAuditEvent.create({
      data: {
        timeEntryId: entry.id,
        action,
        actorId: actor.id,
        fieldName: action === "CLOCK_IN" ? "clockIn" : "clockOut",
        newValue: now.toISOString(),
        comment: exceptionComment,
      },
    });

    const sessions = await tx.timeSession.findMany({
      where: { timeEntryId: entry.id },
      orderBy: { clockIn: "asc" },
    });
    const totalMinutes = computeTotalMinutes(sessions);

    // CB, Oct 2026: "once we approve that schedule beforehand... they should be able to clock in
    // and clock out... it should be marked as complete" around clock-out, not need a second
    // manual Approve stacked on top of the schedule already being approved. Approving a SHIFT
    // and approving a TIMESHEET stay two separate checks (see this function's own doc comment
    // above) — this just means the timesheet check no longer needs a human when there's nothing
    // for a human to actually look at: every session this day matched an already-approved shift,
    // on time, with nothing flagged. `isException` already carries that signal for an ordinary
    // clock-in (no shift / outside the window), and autoCloseStaleClockIns (src/lib/
    // auto-clockout.ts) now sets it too for a forgotten clock-out it had to force-close — so one
    // check here covers every reason this day might still need a look. (Oct 2026: a clean
    // auto-close — the forgotten clock-out landed right at the end of its own scheduled shift,
    // nothing else about the day flagged — now reaches APPROVED on its own the same way, inside
    // autoCloseStaleClockIns itself, rather than waiting for a next clock-in/out through this
    // function to notice; this function's own check is what still covers everything else.) A
    // correction submitted afterward (submitEmployeeCorrection) is a separate path that sets
    // AWAITING_APPROVAL directly and never goes through this function, so it's unaffected and
    // still always reviewed by hand.
    const hasException = sessions.some((s) => s.isException);
    const clockOutStatus = hasException ? "AWAITING_APPROVAL" : "APPROVED";

    const updated = await tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        totalMinutes,
        // Any clock-in — even reopening a day that was already Awaiting Approval, Approved, or
        // Returned — puts the day back "in progress" until it's clocked out again. A clock-out
        // either auto-approves (see clockOutStatus above) or makes it ready for a supervisor's
        // review, same as before. This is what lets someone clock in a second (or third...) time
        // the same day with no separate "reopen" step, and it also means adding time to an
        // already-Approved day correctly re-evaluates it — on a clean reopen it simply
        // auto-approves again, rather than silently leaving a stale approval on now-changed hours.
        status: action === "CLOCK_IN" ? "IN_PROGRESS" : clockOutStatus,
      },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });

    if (action === "CLOCK_OUT" && clockOutStatus === "APPROVED") {
      await tx.timeEntryAuditEvent.create({
        data: {
          timeEntryId: entry.id,
          action: "TIMESHEET_AUTO_APPROVED",
          comment: "Automatically approved — every punch matched an already-approved shift, on time, with nothing flagged.",
        },
      });
    }

    return updated;
  });
}

type ReviewDecision = "APPROVE" | "RETURN";

export class InvalidReviewActionError extends Error {
  constructor(status: string) {
    super(`Can't review this entry — its status is "${status}", not Awaiting Approval.`);
    this.name = "InvalidReviewActionError";
  }
}

export class MissingReturnCommentError extends Error {
  constructor() {
    super("A comment explaining the issue is required when returning a timesheet.");
    this.name = "MissingReturnCommentError";
  }
}

/**
 * Approve or return a single day's time entry. Authorization (is this reviewer actually
 * this employee's supervisor, or HR/Super Admin?) is checked by the caller — see
 * assertCanReviewTimesheet in src/lib/authorization.ts — and independently enforced again
 * here by running the update through withRlsContext under the REVIEWER's identity, so the
 * database's own policy (prisma/rls.sql: time_entry_write_own) has to agree too.
 */
export async function reviewTimeEntry(
  reviewer: CurrentEmployee,
  entryId: string,
  decision: ReviewDecision,
  comment?: string
) {
  if (decision === "RETURN" && !comment?.trim()) {
    throw new MissingReturnCommentError();
  }

  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.status !== "AWAITING_APPROVAL") {
      throw new InvalidReviewActionError(entry?.status ?? "not found");
    }

    const updated = await tx.timeEntry.update({
      where: { id: entryId },
      data: { status: decision === "APPROVE" ? "APPROVED" : "RETURNED" },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });

    await tx.timeEntryAuditEvent.create({
      data: {
        timeEntryId: entryId,
        action: decision === "APPROVE" ? "TIMESHEET_APPROVED" : "TIMESHEET_RETURNED",
        actorId: reviewer.id,
        comment: decision === "RETURN" ? comment!.trim() : undefined,
      },
    });

    return updated;
  });
}

/**
 * Approves every AWAITING_APPROVAL entry in `entryIds` that belongs to `employeeId`, in one
 * shot — the "approve the whole week" button on ReviewTimesheetView. Authorization is the
 * caller's job (assertCanReviewTimesheet against `employeeId`, same as the single-entry
 * approve route) since every id here is expected to belong to the one employee already being
 * reviewed on that page; this still re-checks employeeId per row rather than trusting the
 * list, and silently skips anything not actually AWAITING_APPROVAL (already decided by
 * someone else in the meantime, say) instead of failing the whole batch over one stale row.
 */
export async function bulkApproveTimeEntries(
  reviewer: CurrentEmployee,
  employeeId: string,
  entryIds: string[]
) {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const entries = await tx.timeEntry.findMany({ where: { id: { in: entryIds } } });
    const approvable = entries.filter(
      (e) => e.employeeId === employeeId && e.status === "AWAITING_APPROVAL"
    );

    if (approvable.length > 0) {
      await tx.timeEntry.updateMany({
        where: { id: { in: approvable.map((e) => e.id) } },
        data: { status: "APPROVED" },
      });
      await tx.timeEntryAuditEvent.createMany({
        data: approvable.map((e) => ({
          timeEntryId: e.id,
          action: "TIMESHEET_APPROVED" as const,
          actorId: reviewer.id,
        })),
      });
    }

    return { approvedCount: approvable.length, requestedCount: entryIds.length };
  });
}

export class InvalidCorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCorrectionError";
  }
}

export interface CorrectionSessionInput {
  clockIn: Date;
  clockOut: Date;
}

/** Shared by submitEmployeeCorrection and submitReviewerCorrection below — the same session-list
 *  validation (non-empty, each session's clock out after its clock in, no overlaps once sorted),
 *  pulled out so the two correction paths can't quietly drift apart on what counts as a valid
 *  edit. Returns the sessions sorted by clockIn, same as each call site needs. */
function assertValidSessions(sessions: CorrectionSessionInput[]): CorrectionSessionInput[] {
  if (sessions.length === 0) {
    throw new InvalidCorrectionError("At least one clock-in/clock-out pair is required.");
  }
  for (const s of sessions) {
    if (s.clockOut <= s.clockIn) {
      throw new InvalidCorrectionError("Each session's clock out must be after its clock in.");
    }
  }
  const sorted = [...sessions].sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].clockIn < sorted[i - 1].clockOut) {
      throw new InvalidCorrectionError("Sessions can't overlap each other.");
    }
  }
  return sorted;
}

/** Shared by submitEmployeeCorrection and submitReviewerCorrection below — a single-string
 *  before/after summary of a session list, for the audit trail. */
function describeSessions(list: { clockIn: Date; clockOut: Date | null }[]): string {
  return list.length === 0
    ? "none"
    : list.map((s) => `${s.clockIn.toISOString()}–${s.clockOut?.toISOString() ?? "open"}`).join(", ");
}

/**
 * Oct 2026 (CB, looking at a corrected day in Review Timesheet with no "Scheduled ___" line
 * under it: "when we correct something I should be able to see what was the scheduled time as
 * well"). submitEmployeeCorrection/submitReviewerCorrection below both replace a day's sessions
 * wholesale (delete-then-recreate — see their own doc comments for why), and neither ever set
 * the new rows' `shiftId` — so a session that matched a real scheduled shift at clock-in (and
 * would otherwise show "Scheduled ___" right next to the recorded time, per TimesheetTable's own
 * doc comment on that exact line) went permanently quiet on that comparison the moment anyone
 * corrected the day, even though the schedule it should be checked against never changed. This
 * re-resolves that schedule fresh from the entry's own employeeId/workDate (not from whatever the
 * old sessions happened to be pointing at, which could itself already be stale) so every call
 * site below can just attach it to the rows it's about to create.
 *
 * CANCELLED/REASSIGNED excluded, same exclusion dashboard/page.tsx's own upcomingShifts filter
 * already uses — a cancelled or reassigned-away shift was never really "the schedule" for this
 * employee this day. When more than one shift matches (a split shift — rare, but the data model
 * allows it), picks whichever starts closest to the day's own earliest session, same nearest-
 * match idea resolveClockInShift already uses for a live clock-in, just scored against the day's
 * real recorded times instead of "right now." Returns null (and leaves shiftId null, same as an
 * ordinary ad-hoc clock-in with nothing on the books) when nothing was ever scheduled that day —
 * nothing new to compare against, so TimesheetTable's "Scheduled ___" line correctly stays quiet.
 */
async function findShiftIdForCorrection(
  tx: PrismaClient,
  employeeId: string,
  workDate: Date,
  sessions: CorrectionSessionInput[]
): Promise<string | null> {
  const dateKey = workDate.toISOString().slice(0, 10);
  const candidates = await tx.shift.findMany({
    where: { employeeId, date: dateKey, status: { notIn: ["CANCELLED", "REASSIGNED"] } },
    select: { id: true, startTime: true },
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  const earliestClockIn = sessions.reduce((min, s) => (s.clockIn < min ? s.clockIn : min), sessions[0].clockIn).getTime();
  const nearest = candidates.reduce((best, c) => {
    const bestStart = zonedDateTimeToUtc(dateKey, best.startTime).getTime();
    const cStart = zonedDateTimeToUtc(dateKey, c.startTime).getTime();
    return Math.abs(cStart - earliestClockIn) < Math.abs(bestStart - earliestClockIn) ? c : best;
  });
  return nearest.id;
}

/**
 * Closes the loop a supervisor's Return opens: the employee edits their own returned day
 * (now a list of sessions, not four fixed fields) and resubmits it. Only reachable on the
 * employee's OWN entry, and only while its status is RETURNED — an approved or in-progress day
 * can't be quietly edited through this path. The whole session list is replaced in one shot
 * (delete-then-recreate) rather than diffed field-by-field, since sessions can be added or
 * removed, not just retimed; the audit trail still records a single before/after summary so the
 * correction is visible in the same audit trail as everything else, never a silent overwrite.
 */
export async function submitEmployeeCorrection(
  actor: CurrentEmployee,
  entryId: string,
  sessions: CorrectionSessionInput[]
) {
  const sorted = assertValidSessions(sessions);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId }, include: { sessions: true } });
    if (!entry || entry.employeeId !== actor.id) {
      throw new InvalidCorrectionError("Time entry not found.");
    }
    if (entry.status !== "RETURNED") {
      throw new InvalidCorrectionError('Only a "Returned" day can be corrected.');
    }

    const oldSummary = describeSessions(entry.sessions);
    const newSummary = describeSessions(sorted);
    const shiftId = await findShiftIdForCorrection(tx, entry.employeeId, entry.workDate, sorted);

    await tx.timeSession.deleteMany({ where: { timeEntryId: entryId } });
    await tx.timeSession.createMany({
      data: sorted.map((s) => ({ timeEntryId: entryId, clockIn: s.clockIn, clockOut: s.clockOut, shiftId })),
    });

    const totalMinutes = computeTotalMinutes(sorted);

    const updated = await tx.timeEntry.update({
      where: { id: entryId },
      data: { totalMinutes, status: "AWAITING_APPROVAL" },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });

    await tx.timeEntryAuditEvent.create({
      data: {
        timeEntryId: entryId,
        action: "EMPLOYEE_CORRECTION_REQUESTED",
        actorId: actor.id,
        fieldName: "sessions",
        oldValue: oldSummary,
        newValue: newSummary,
      },
    });

    return updated;
  });
}

/**
 * Round 10 (CB, Oct 2026, pointing at Haile's flagged double-clock-in recorded as 0h 00m: "we
 * should have the option to adjust the time and manually edit the time... but remember only
 * Shawn and I am supposed to be able to have those types of capabilities"). The reviewer-side
 * counterpart to submitEmployeeCorrection just above — same session-replace shape (validate,
 * delete-then-recreate, before/after audit summary) — but for a DIFFERENT entry/status pairing:
 * a flagged entry, not one already RETURNED back to the employee — and it resolves the review in
 * the same step rather than handing it back for a second look, since the corrected times land
 * straight on APPROVED either way and the reviewer editing them IS the review.
 *
 * Round 11 (CB, Oct 2026, pointing at that exact same Haile entry again — by then it had already
 * been left Approved as-is, 0h 00m and all): the status check below originally only allowed
 * AWAITING_APPROVAL, on the assumption a reviewer would always catch a flagged day before
 * approving it. In practice a flagged day can reach APPROVED first — an admin approves it before
 * noticing the flag, or it was approved before this capability existed — and still need fixing
 * afterward, so this now accepts either AWAITING_APPROVAL or APPROVED as the starting status,
 * landing on APPROVED either way once corrected. Authorization (actually Shawn or CB, and
 * actually allowed to reach this employee's records) is the caller's job — see
 * assertCanEditFlaggedTimeEntries in src/lib/authorization.ts — enforced again here via
 * withRlsContext under the REVIEWER's own identity, same layered pattern reviewTimeEntry already
 * uses.
 */
export async function submitReviewerCorrection(
  reviewer: CurrentEmployee,
  entryId: string,
  sessions: CorrectionSessionInput[]
) {
  const sorted = assertValidSessions(sessions);

  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId }, include: { sessions: true } });
    if (!entry) {
      throw new InvalidCorrectionError("Time entry not found.");
    }
    if (entry.status !== "AWAITING_APPROVAL" && entry.status !== "APPROVED") {
      throw new InvalidCorrectionError("Only a day that's Awaiting Approval or already Approved can have its times edited this way.");
    }

    const oldSummary = describeSessions(entry.sessions);
    const newSummary = describeSessions(sorted);
    const shiftId = await findShiftIdForCorrection(tx, entry.employeeId, entry.workDate, sorted);

    await tx.timeSession.deleteMany({ where: { timeEntryId: entryId } });
    await tx.timeSession.createMany({
      data: sorted.map((s) => ({ timeEntryId: entryId, clockIn: s.clockIn, clockOut: s.clockOut, shiftId })),
    });

    const totalMinutes = computeTotalMinutes(sorted);

    const updated = await tx.timeEntry.update({
      where: { id: entryId },
      data: { totalMinutes, status: "APPROVED" },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });

    await tx.timeEntryAuditEvent.create({
      data: {
        timeEntryId: entryId,
        action: "HR_CORRECTION",
        actorId: reviewer.id,
        fieldName: "sessions",
        oldValue: oldSummary,
        newValue: newSummary,
      },
    });

    return updated;
  });
}

/**
 * Oct 2026 (CB, looking at Donique's card running 5h21m past her scheduled end on the Home
 * dashboard's "Clocked in now": "I feel like there should be kind of an option... from an admin
 * perspective... to stop it and correct it"). Everything above this point only ever touches an
 * entry that's already CLOSED — submitReviewerCorrection requires both a clockIn AND a clockOut
 * for every session, so it has no way to act on a session that's still actively open right now.
 * autoCloseStaleClockIns (src/lib/auto-clockout.ts) is the only thing that ever force-closes a
 * live session today, and only once it's been open 4 hours — this is the same idea (force-close,
 * prefer the schedule over whatever time it happens to be), just reachable immediately instead
 * of waiting on that cap, for the one open session the caller is actually looking at.
 *
 * Same "actually Shawn or CB, and actually allowed to reach this employee's records" authorization
 * split as submitReviewerCorrection just above — assertCanEditFlaggedTimeEntries is the caller's
 * job (see POST /api/time/sessions/[id]/force-clock-out), not re-checked in here, since this is
 * the same class of action (changing someone else's recorded clock time) CB restricted to just
 * the two of them.
 *
 * Deliberately narrow: only ever closes the ONE open session passed in, lands the day on
 * APPROVED exactly like submitReviewerCorrection does (the reviewer setting the time IS the
 * review), and refuses outright if this employee's day somehow already has a different open
 * session too (shouldn't be possible — a person can only be clocked in once at a time — but
 * failing loudly here beats silently guessing which one was meant).
 */
export async function forceClockOutSession(
  reviewer: CurrentEmployee,
  sessionId: string,
  clockOut: Date
) {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const session = await tx.timeSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        timeEntryId: true,
        timeEntry: { select: { employeeId: true, sessions: true } },
      },
    });
    if (!session) {
      throw new InvalidCorrectionError("That clock-in session couldn't be found.");
    }
    if (session.clockOut) {
      throw new InvalidCorrectionError("This session is already clocked out.");
    }
    if (clockOut <= session.clockIn) {
      throw new InvalidCorrectionError("Clock-out time must be after the clock-in time.");
    }
    if (clockOut > new Date()) {
      throw new InvalidCorrectionError("Clock-out time can't be in the future.");
    }

    const siblingSessions = session.timeEntry.sessions.filter((s) => s.id !== sessionId);
    if (siblingSessions.some((s) => !s.clockOut)) {
      throw new InvalidCorrectionError("This day already has another open session — correct it from Review Timesheet instead.");
    }

    const oldSummary = describeSessions(session.timeEntry.sessions);
    const candidate: CorrectionSessionInput[] = [
      ...siblingSessions.map((s) => ({ clockIn: s.clockIn, clockOut: s.clockOut as Date })),
      { clockIn: session.clockIn, clockOut },
    ];
    const sorted = assertValidSessions(candidate);

    await tx.timeSession.update({ where: { id: sessionId }, data: { clockOut } });

    const totalMinutes = computeTotalMinutes(sorted);
    const updated = await tx.timeEntry.update({
      where: { id: session.timeEntryId },
      data: { totalMinutes, status: "APPROVED" },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });

    await tx.timeEntryAuditEvent.create({
      data: {
        timeEntryId: session.timeEntryId,
        action: "HR_CORRECTION",
        actorId: reviewer.id,
        fieldName: "clockOut",
        oldValue: oldSummary,
        newValue: describeSessions(sorted),
        comment: "Clocked out from an active session and corrected the time.",
      },
    });

    return updated;
  });
}

export class InvalidTimeEntryDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTimeEntryDeleteError";
  }
}

/**
 * CB, Sept 2026: "I should be able to delete those times... if I swipe... on the respective
 * date block." Then Sept 2026 again, after seeing it in practice: a team member should be able
 * to fully revert a logged day before it's "confirmed" — i.e. any entry still Awaiting Approval,
 * not just an accidental zero-minute one. Confirmed scope (her own words): "I like... true
 * delete[,] awaiting approval only... they wouldn't be able to do that on their side once we
 * approve." That last part is a hard, no-exceptions lock: once a supervisor or HR/Super Admin
 * approves a day, the employee can't remove it here at all — not even an old zero-minute mistake
 * that happened to get swept up in a bulk-approve. (If that turns out to matter in practice, it's
 * a discrepancy for HR/Admin to handle on their side, per CB's own follow-up about that — see
 * ReviewTimesheetView, which doesn't have that capability yet.)
 *
 * That lock is deliberate, not incidental: a TimeEntry's audit trail is documented as an
 * immutable log ("a TimeEntry is never silently overwritten" — see prisma/schema.prisma)
 * precisely so real worked hours are never quietly erased once someone has signed off on them —
 * a real wage/hour recordkeeping concern for actual hourly employees, not just a UI nicety. Below
 * Approved, the rule is unchanged from before this phase: any Awaiting Approval day, or a
 * zero-minute mistake regardless of its (non-Approved) status. A Returned day with real time on
 * it still isn't deletable here — it already has a path back (Edit & resubmit), and that path is
 * what keeps the supervisor's return comment attached to something.
 *
 * Oct 2026: that lock's whole reason is "someone has signed off on them" — since applyClockAction
 * can now also reach APPROVED on its own (see its own doc comment) with nobody having looked at
 * it yet, a day that reached APPROVED that way is NOT locked here; only a day a human actually
 * reviewed (reviewTimeEntry/bulkApproveTimeEntries, a real TIMESHEET_APPROVED audit row) is.
 * Determined by the most recent approval-type audit event for this entry — whichever of
 * TIMESHEET_APPROVED/TIMESHEET_AUTO_APPROVED happened last is what actually produced the status
 * sitting on the entry right now (a clock-in always resets to IN_PROGRESS first, so there's never
 * a stale one of these sitting underneath a newer clock-out's own outcome).
 *
 * Deletes the entry's own audit rows first since there's nothing worth preserving for a day
 * that's being fully withdrawn, then the entry itself (its sessions cascade per the schema).
 */
export async function deleteEmployeeTimeEntry(actor: CurrentEmployee, entryId: string): Promise<void> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.employeeId !== actor.id) {
      throw new InvalidTimeEntryDeleteError("Time entry not found.");
    }
    let wasAutoApproved = false;
    if (entry.status === "APPROVED") {
      const lastApproval = await tx.timeEntryAuditEvent.findFirst({
        where: { timeEntryId: entryId, action: { in: ["TIMESHEET_APPROVED", "TIMESHEET_AUTO_APPROVED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (lastApproval?.action !== "TIMESHEET_AUTO_APPROVED") {
        throw new InvalidTimeEntryDeleteError(
          "An approved day can't be deleted — contact your supervisor or HR about a correction."
        );
      }
      // Nobody has actually reviewed this one (see this function's own doc comment) — treated
      // the same as an Awaiting Approval day just below, not gated on totalMinutes being zero
      // the way a genuinely Returned day still is.
      wasAutoApproved = true;
    }
    const isEmptyMistake = (entry.totalMinutes ?? 0) === 0;
    if (entry.status !== "AWAITING_APPROVAL" && !wasAutoApproved && !isEmptyMistake) {
      throw new InvalidTimeEntryDeleteError(
        "Only a day that's Awaiting Approval (or has no recorded time) can be deleted — use Edit & resubmit to fix a Returned day instead."
      );
    }
    await tx.timeEntryAuditEvent.deleteMany({ where: { timeEntryId: entryId } });
    await tx.timeEntry.delete({ where: { id: entryId } });
  });
}

export async function getTodayEntry(actor: CurrentEmployee) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const workDate = new Date(`${todayDateKey()}T00:00:00.000Z`);
    return tx.timeEntry.findUnique({
      where: { employeeId_workDate: { employeeId: actor.id, workDate } },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });
  });
}
