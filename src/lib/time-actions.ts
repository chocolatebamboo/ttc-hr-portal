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

export async function getTodayEntry(actor: CurrentEmployee) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const workDate = new Date(`${todayDateKey()}T00:00:00.000Z`);
    return tx.timeEntry.findUnique({
      where: { employeeId_workDate: { employeeId: actor.id, workDate } },
    });
  });
}
