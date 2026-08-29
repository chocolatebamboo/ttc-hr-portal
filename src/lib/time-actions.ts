import { withRlsContext } from "@/lib/db";
import { computeTotalMinutes, deriveClockState, todayDateKey } from "@/lib/time";
import type { CurrentEmployee, TimeClockState } from "@/types";

export class InvalidClockActionError extends Error {
  constructor(action: string, currentState: TimeClockState) {
    super(`Can't ${action} — today's status is ${currentState}.`);
    this.name = "InvalidClockActionError";
  }
}

type ClockAction = "CLOCK_IN" | "LUNCH_START" | "LUNCH_END" | "CLOCK_OUT";

const ALLOWED_FROM: Record<ClockAction, TimeClockState[]> = {
  CLOCK_IN: ["BEFORE_WORK"],
  LUNCH_START: ["CLOCKED_IN"],
  LUNCH_END: ["ON_LUNCH"],
  CLOCK_OUT: ["CLOCKED_IN", "AFTER_LUNCH"],
};

const AUDIT_ACTION: Record<ClockAction, "CLOCK_IN" | "LUNCH_STARTED" | "LUNCH_ENDED" | "CLOCK_OUT"> = {
  CLOCK_IN: "CLOCK_IN",
  LUNCH_START: "LUNCH_STARTED",
  LUNCH_END: "LUNCH_ENDED",
  CLOCK_OUT: "CLOCK_OUT",
};

/**
 * The one function every time-clock API route calls. It re-derives the current state from
 * the database (never trusts what the client thinks the state is), rejects anything that
 * isn't the single legal next action, and appends an audit event alongside the update —
 * an entry's history is never silently overwritten, per the brief's audit-trail requirement.
 */
export async function applyClockAction(actor: CurrentEmployee, action: ClockAction) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const workDate = new Date(`${todayDateKey()}T00:00:00.000Z`);
    const now = new Date();

    let entry = await tx.timeEntry.findUnique({
      where: { employeeId_workDate: { employeeId: actor.id, workDate } },
    });

    const currentState = deriveClockState(
      entry
        ? {
            id: entry.id,
            workDate: entry.workDate.toISOString(),
            clockIn: entry.clockIn?.toISOString() ?? null,
            lunchStart: entry.lunchStart?.toISOString() ?? null,
            lunchEnd: entry.lunchEnd?.toISOString() ?? null,
            clockOut: entry.clockOut?.toISOString() ?? null,
            totalMinutes: entry.totalMinutes,
            status: entry.status,
          }
        : null
    );

    if (!ALLOWED_FROM[action].includes(currentState)) {
      throw new InvalidClockActionError(action, currentState);
    }

    let createdNew = false;
    if (!entry) {
      entry = await tx.timeEntry.create({
        data: { employeeId: actor.id, workDate, status: "IN_PROGRESS" },
      });
      createdNew = true;
    }

    const fieldByAction: Record<ClockAction, "clockIn" | "lunchStart" | "lunchEnd" | "clockOut"> = {
      CLOCK_IN: "clockIn",
      LUNCH_START: "lunchStart",
      LUNCH_END: "lunchEnd",
      CLOCK_OUT: "clockOut",
    };
    const field = fieldByAction[action];

    const totalMinutes =
      action === "CLOCK_OUT"
        ? computeTotalMinutes({
            clockIn: entry.clockIn,
            lunchStart: entry.lunchStart,
            lunchEnd: entry.lunchEnd,
            clockOut: now,
          })
        : entry.totalMinutes;

    const updated = await tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        [field]: now,
        totalMinutes,
        status: action === "CLOCK_OUT" ? "AWAITING_APPROVAL" : "IN_PROGRESS",
      },
    });

    if (createdNew) {
      await tx.timeEntryAuditEvent.create({
        data: { timeEntryId: entry.id, action: "ENTRY_CREATED", actorId: actor.id },
      });
    }
    await tx.timeEntryAuditEvent.create({
      data: {
        timeEntryId: entry.id,
        action: AUDIT_ACTION[action],
        actorId: actor.id,
        fieldName: field,
        newValue: now.toISOString(),
      },
    });

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

export interface CorrectionInput {
  clockIn: Date | null;
  lunchStart: Date | null;
  lunchEnd: Date | null;
  clockOut: Date | null;
}

/**
 * Closes the loop a supervisor's Return opens: the employee edits their own returned day
 * and resubmits it. Only reachable on the employee's OWN entry, and only while its status
 * is RETURNED — an approved or in-progress day can't be quietly edited through this path.
 * Every changed field is logged individually (old → new) so the correction is visible in
 * the same audit trail as everything else, never a silent overwrite.
 */
export async function submitEmployeeCorrection(
  actor: CurrentEmployee,
  entryId: string,
  input: CorrectionInput
) {
  if (!input.clockIn || !input.clockOut) {
    throw new InvalidCorrectionError("Clock in and clock out times are both required.");
  }
  if (input.clockOut <= input.clockIn) {
    throw new InvalidCorrectionError("Clock out must be after clock in.");
  }
  if ((input.lunchStart && !input.lunchEnd) || (!input.lunchStart && input.lunchEnd)) {
    throw new InvalidCorrectionError("Lunch needs both a start and an end time, or neither.");
  }
  if (input.lunchStart && input.lunchEnd) {
    if (input.lunchEnd <= input.lunchStart) {
      throw new InvalidCorrectionError("Lunch end must be after lunch start.");
    }
    if (input.lunchStart < input.clockIn || input.lunchEnd > input.clockOut) {
      throw new InvalidCorrectionError("Lunch must fall between clock in and clock out.");
    }
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.employeeId !== actor.id) {
      throw new InvalidCorrectionError("Time entry not found.");
    }
    if (entry.status !== "RETURNED") {
      throw new InvalidCorrectionError('Only a "Returned" day can be corrected.');
    }

    const totalMinutes = computeTotalMinutes(input);

    const updated = await tx.timeEntry.update({
      where: { id: entryId },
      data: {
        clockIn: input.clockIn,
        lunchStart: input.lunchStart,
        lunchEnd: input.lunchEnd,
        clockOut: input.clockOut,
        totalMinutes,
        status: "AWAITING_APPROVAL",
      },
    });

    const fields: Array<[string, Date | null, Date | null]> = [
      ["clockIn", entry.clockIn, input.clockIn],
      ["lunchStart", entry.lunchStart, input.lunchStart],
      ["lunchEnd", entry.lunchEnd, input.lunchEnd],
      ["clockOut", entry.clockOut, input.clockOut],
    ];
    for (const [fieldName, oldValue, newValue] of fields) {
      if (oldValue?.getTime() !== newValue?.getTime()) {
        await tx.timeEntryAuditEvent.create({
          data: {
            timeEntryId: entryId,
            action: "EMPLOYEE_CORRECTION_REQUESTED",
            actorId: actor.id,
            fieldName,
            oldValue: oldValue?.toISOString() ?? null,
            newValue: newValue?.toISOString() ?? null,
          },
        });
      }
    }

    return updated;
  });
}

export async function getTodayEntry(actor: CurrentEmployee) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const workDate = new Date(`${todayDateKey()}T00:00:00.000Z`);
    return tx.timeEntry.findUnique({
      where: { employeeId_workDate: { employeeId: actor.id, workDate } },
    });
  });
}
