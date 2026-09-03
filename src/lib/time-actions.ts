import { withRlsContext } from "@/lib/db";
import { computeTotalMinutes, todayDateKey } from "@/lib/time";
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

type ClockAction = "CLOCK_IN" | "CLOCK_OUT";

/**
 * The one function every time-clock API route calls. Re-derives the current state from the
 * database (never trusts what the client thinks the state is) and rejects anything but the
 * single legal next action: Clock In only while there's no open session, Clock Out only while
 * there is one. Any number of clock-in/clock-out pairs are allowed per day now — no lunch step,
 * no cap — so this is deliberately just two states rather than the old four-stage flow.
 */
export async function applyClockAction(actor: CurrentEmployee, action: ClockAction) {
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

    if (action === "CLOCK_IN") {
      await tx.timeSession.create({ data: { timeEntryId: entry.id, clockIn: now } });
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
      },
    });

    const sessions = await tx.timeSession.findMany({
      where: { timeEntryId: entry.id },
      orderBy: { clockIn: "asc" },
    });
    const totalMinutes = computeTotalMinutes(sessions);

    return tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        totalMinutes,
        // Any clock-in — even reopening a day that was already Awaiting Approval, Approved, or
        // Returned — puts the day back "in progress" until it's clocked out again; any clock-out
        // makes it ready for review. This is what lets someone clock in a second (or third...)
        // time the same day with no separate "reopen" step, and it also means adding time to an
        // already-Approved day correctly asks the supervisor to look again rather than silently
        // leaving a stale approval on now-changed hours.
        status: action === "CLOCK_IN" ? "IN_PROGRESS" : "AWAITING_APPROVAL",
      },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });
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

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId }, include: { sessions: true } });
    if (!entry || entry.employeeId !== actor.id) {
      throw new InvalidCorrectionError("Time entry not found.");
    }
    if (entry.status !== "RETURNED") {
      throw new InvalidCorrectionError('Only a "Returned" day can be corrected.');
    }

    const describe = (list: { clockIn: Date; clockOut: Date | null }[]) =>
      list.length === 0
        ? "none"
        : list
            .map((s) => `${s.clockIn.toISOString()}–${s.clockOut?.toISOString() ?? "open"}`)
            .join(", ");
    const oldSummary = describe(entry.sessions);
    const newSummary = describe(sorted);

    await tx.timeSession.deleteMany({ where: { timeEntryId: entryId } });
    await tx.timeSession.createMany({
      data: sorted.map((s) => ({ timeEntryId: entryId, clockIn: s.clockIn, clockOut: s.clockOut })),
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

export async function getTodayEntry(actor: CurrentEmployee) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const workDate = new Date(`${todayDateKey()}T00:00:00.000Z`);
    return tx.timeEntry.findUnique({
      where: { employeeId_workDate: { employeeId: actor.id, workDate } },
      include: { sessions: { orderBy: { clockIn: "asc" } } },
    });
  });
}
