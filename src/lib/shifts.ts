import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { assertCanAccessEmployeeRecords, assertCanManageShifts, isAdmin, ForbiddenError } from "@/lib/authorization";
import { orgNow, timeToMinutes } from "@/lib/time";
import type { CurrentEmployee, ShiftDTO, ShiftStatus, AdminShiftDTO } from "@/types";

/**
 * Phase 1 of the scheduling/attendance/task workflow rebuild (client spec, Sept 2026) — the
 * "Scheduling" step, deliberately separate from "Availability": see Shift's own doc comment in
 * prisma/schema.prisma for the full reasoning behind a distinct table rather than treating an
 * APPROVED AvailabilitySubmission as the confirmed schedule the way the app did before this.
 */

export class InvalidShiftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShiftError";
  }
}

export class ShiftNotFoundError extends Error {
  constructor(message = "That shift couldn't be found.") {
    super(message);
    this.name = "ShiftNotFoundError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function nameOf(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

const SHIFT_INCLUDE = {
  employee: {
    select: {
      firstName: true,
      lastName: true,
      preferredName: true,
      departmentId: true,
      department: { select: { name: true } },
    },
  },
  createdBy: { select: { firstName: true, lastName: true, preferredName: true } },
  reviewedBy: { select: { firstName: true, lastName: true, preferredName: true } },
} as const;

type ShiftRow = {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  note: string | null;
  sourceAvailabilitySubmissionId: string | null;
  createdById: string;
  changeReason: string | null;
  requestedDate: string | null;
  requestedStartTime: string | null;
  requestedEndTime: string | null;
  requestedAt: Date | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  cancelReason: string | null;
  reassignedFromShiftId: string | null;
  createdAt: Date;
  employee: {
    firstName: string;
    lastName: string;
    preferredName: string | null;
    departmentId: string | null;
    department: { name: string } | null;
  };
  createdBy: { firstName: string; lastName: string; preferredName: string | null };
  reviewedBy: { firstName: string; lastName: string; preferredName: string | null } | null;
};

/**
 * Read-time-derived Upcoming/In Progress/Completed/Missed for a shift whose STORED `status` is
 * still UPCOMING — see ShiftDTO.displayStatus's own doc comment in src/types/index.ts for why
 * this is computed here rather than written to the row by some background job. Every other
 * stored status (a real decision: CANCELLED, REASSIGNED, or a phase-2 *_REQUESTED state) passes
 * straight through unchanged — those are actual decisions, never something to re-derive from
 * the clock.
 *
 * `hasLoggedTime` is whether the employee has ANY recorded clock time on this shift's date.
 * Phase 1 has no direct Shift<->TimeEntry link yet (that's phase 3's "clock-in gated to a
 * scheduled shift"), so this is the best available signal from what already exists — TimeEntry
 * is already keyed by (employeeId, workDate) — rather than a guess. Phase 3 will replace this
 * with a real shift-scoped attendance check once clock-in is actually tied to a Shift.
 */
export function deriveShiftDisplayStatus(
  shift: { date: string; startTime: string; endTime: string; status: ShiftStatus },
  hasLoggedTime: boolean
): ShiftStatus {
  if (shift.status !== "UPCOMING") return shift.status;

  const { dateKey: today, minutesSinceMidnight: nowMinutes } = orgNow();
  if (shift.date > today) return "UPCOMING";

  const windowHasEnded = shift.date < today || nowMinutes >= timeToMinutes(shift.endTime);
  if (!windowHasEnded) return hasLoggedTime ? "IN_PROGRESS" : "UPCOMING";
  return hasLoggedTime ? "COMPLETED" : "MISSED";
}

/** Batches the "did this employee log any time on this date" lookup for a whole list of shifts
 *  at once instead of one query per row — same batching shape src/lib/team-notes.ts's
 *  aggregateTopicCounts uses for per-date message counts. */
async function loadLoggedTimeFlags(
  tx: PrismaClient,
  shifts: { employeeId: string; date: string }[]
): Promise<Set<string>> {
  const uniquePairs = new Map<string, { employeeId: string; workDate: Date }>();
  for (const s of shifts) {
    const key = `${s.employeeId}:${s.date}`;
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { employeeId: s.employeeId, workDate: new Date(`${s.date}T00:00:00.000Z`) });
    }
  }
  if (uniquePairs.size === 0) return new Set();

  const entries = await tx.timeEntry.findMany({
    where: { OR: [...uniquePairs.values()], totalMinutes: { gt: 0 } },
    select: { employeeId: true, workDate: true },
  });

  const flagged = new Set<string>();
  for (const e of entries) {
    flagged.add(`${e.employeeId}:${e.workDate.toISOString().slice(0, 10)}`);
  }
  return flagged;
}

function toDTO(row: ShiftRow, displayStatus: ShiftStatus): ShiftDTO {
  return {
    id: row.id,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status as ShiftStatus,
    displayStatus,
    note: row.note,
    sourceAvailabilitySubmissionId: row.sourceAvailabilitySubmissionId,
    changeReason: row.changeReason,
    requestedDate: row.requestedDate,
    requestedStartTime: row.requestedStartTime,
    requestedEndTime: row.requestedEndTime,
    requestedAt: row.requestedAt ? row.requestedAt.toISOString() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewComment: row.reviewComment,
    cancelReason: row.cancelReason,
    reassignedFromShiftId: row.reassignedFromShiftId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAdminDTO(row: ShiftRow, displayStatus: ShiftStatus): AdminShiftDTO {
  return {
    ...toDTO(row, displayStatus),
    employeeId: row.employeeId,
    employeeName: nameOf(row.employee),
    departmentId: row.employee.departmentId,
    departmentName: row.employee.department?.name ?? null,
    createdById: row.createdById,
    createdByName: nameOf(row.createdBy),
    reviewedByName: row.reviewedBy ? nameOf(row.reviewedBy) : null,
  };
}

async function writeShiftAuditLog(
  tx: PrismaClient,
  params: { actorId: string; action: string; targetId: string; oldValue?: string; newValue?: string; comment?: string }
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: "Shift",
      targetId: params.targetId,
      oldValue: params.oldValue ?? null,
      newValue: params.newValue ?? null,
      comment: params.comment ?? null,
    },
  });
}

/** The signed-in team member's own confirmed shifts, soonest first — "My Schedule" is about
 *  what's coming up, unlike Availability's own newest-submitted-first history. */
export async function listMyShifts(actor: CurrentEmployee): Promise<ShiftDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.shift.findMany({
      where: { employeeId: actor.id },
      include: SHIFT_INCLUDE,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
    const logged = await loadLoggedTimeFlags(tx, rows);
    return rows.map((r) => toDTO(r, deriveShiftDisplayStatus(r, logged.has(`${r.employeeId}:${r.date}`))));
  });
}

/** A supervisor/HR reviewing one direct report's confirmed shifts — same access rule as
 *  listAvailabilityForEmployee. */
export async function listShiftsForEmployee(actor: CurrentEmployee, employeeId: string): Promise<ShiftDTO[]> {
  await assertCanAccessEmployeeRecords(actor, employeeId);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.shift.findMany({
      where: { employeeId },
      include: SHIFT_INCLUDE,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
    const logged = await loadLoggedTimeFlags(tx, rows);
    return rows.map((r) => toDTO(r, deriveShiftDisplayStatus(r, logged.has(`${r.employeeId}:${r.date}`))));
  });
}

export interface AdminShiftFilters {
  employeeId?: string;
  departmentId?: string;
  status?: ShiftStatus;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * The Team Schedule admin/supervisor view — admin sees every shift org-wide; a supervisor sees
 * only their own reports' shifts. Unlike listAdminAvailability/listAdminPto (admin-only pages),
 * Team Schedule is meant for supervisors too, per the client spec's "Supervisor: Manage
 * availability, shifts, attendance, tasks... for Team Members under their supervision" — so the
 * supervisor-scoping below is a real query condition, not just something RLS happens to also
 * enforce underneath it.
 */
export async function listAdminShifts(actor: CurrentEmployee, filters: AdminShiftFilters = {}): Promise<AdminShiftDTO[]> {
  if (actor.role !== "SUPERVISOR" && !isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employeeFilter: Record<string, unknown> = {};
    if (filters.departmentId) employeeFilter.departmentId = filters.departmentId;
    if (!isAdmin(actor)) employeeFilter.supervisorId = actor.id;

    const rows = await tx.shift.findMany({
      where: {
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.dateFrom || filters.dateTo
          ? {
              date: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
              },
            }
          : {}),
        ...(Object.keys(employeeFilter).length > 0 ? { employee: employeeFilter } : {}),
      },
      include: SHIFT_INCLUDE,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
    const logged = await loadLoggedTimeFlags(tx, rows);
    return rows.map((r) => toAdminDTO(r, deriveShiftDisplayStatus(r, logged.has(`${r.employeeId}:${r.date}`))));
  });
}

function assertValidDateTime(date: string, startTime: string, endTime: string): void {
  if (!DATE_RE.test(date)) throw new InvalidShiftError("Choose a valid date.");
  if (!TIME_RE.test(startTime)) throw new InvalidShiftError("Choose a valid start time.");
  if (!TIME_RE.test(endTime)) throw new InvalidShiftError("Choose a valid end time.");
  if (endTime <= startTime) throw new InvalidShiftError("End time must be after start time.");
}

/**
 * Converts ONE date out of an already-APPROVED availability submission into a real confirmed
 * Shift — the actual "Scheduling" step, deliberately separate from decideAvailability's own
 * APPROVED/DENIED decision (see Shift's doc comment in prisma/schema.prisma). Per-date, not
 * per-submission: TeamAvailabilityCards already reviews and converses about a submission one
 * date-chip at a time, so scheduling follows the same granularity rather than an all-or-nothing
 * convert. Refuses a date that already has a live (non-cancelled) Shift rather than silently
 * creating a duplicate.
 */
export async function convertAvailabilityDateToShift(
  actor: CurrentEmployee,
  submissionId: string,
  date: string
): Promise<ShiftDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const submission = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!submission) throw new InvalidShiftError("Submission not found.");
    await assertCanManageShifts(actor, submission.employeeId);
    if (submission.status !== "APPROVED") {
      throw new InvalidShiftError("Only an approved submission can become a shift.");
    }

    const slots = submission.slots as unknown as { date: string; startTime: string; endTime: string }[];
    const slot = slots.find((s) => s.date === date);
    if (!slot) throw new InvalidShiftError("That date isn't part of this submission.");

    const existing = await tx.shift.findFirst({
      where: { sourceAvailabilitySubmissionId: submissionId, date, status: { not: "CANCELLED" } },
    });
    if (existing) throw new InvalidShiftError("This date already has a confirmed shift.");

    const row = await tx.shift.create({
      data: {
        employeeId: submission.employeeId,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        note: submission.note,
        sourceAvailabilitySubmissionId: submission.id,
        createdById: actor.id,
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_CREATED",
      targetId: row.id,
      newValue: `${row.date} ${row.startTime}-${row.endTime} for ${submission.employeeId} (converted from availability ${submission.id})`,
    });
    return toDTO(row, deriveShiftDisplayStatus(row, false));
  });
}

export interface CreateShiftInput {
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  note?: string;
}

/** "Create a shift manually when needed" — no source availability submission required at all; a
 *  supervisor/admin can schedule a date nobody necessarily submitted availability for. */
export async function createShiftManually(actor: CurrentEmployee, input: CreateShiftInput): Promise<ShiftDTO> {
  await assertCanManageShifts(actor, input.employeeId);
  assertValidDateTime(input.date, input.startTime, input.endTime);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.shift.create({
      data: {
        employeeId: input.employeeId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        note: input.note?.trim() || null,
        createdById: actor.id,
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_CREATED",
      targetId: row.id,
      newValue: `${row.date} ${row.startTime}-${row.endTime} for ${input.employeeId} (created manually)`,
    });
    return toDTO(row, deriveShiftDisplayStatus(row, false));
  });
}

async function loadShiftRow(tx: PrismaClient, shiftId: string): Promise<ShiftRow> {
  const row = await tx.shift.findUnique({ where: { id: shiftId }, include: SHIFT_INCLUDE });
  if (!row) throw new ShiftNotFoundError();
  return row;
}

// Phase 2 (client spec, Sept 2026): "Once availability is approved and becomes a confirmed
// shift, the Team Member must not be able to edit or delete it directly. Instead, provide:
// Request Shift Change, Request Cancellation... The Supervisor or Admin can: Approve the
// request. Decline the request. Change the shift time. Cancel the shift. Reassign the shift." —
// so a reviewer's RESPONSE to a pending request isn't limited to approve/decline; cancelling or
// reassigning outright are equally valid responses. That's why cancelShift/reassignShift below
// accept these two *_REQUESTED statuses as a starting point too, not just UPCOMING — acting on
// either one this way resolves the pending request as a side effect, same as an explicit
// approve/decline would.
const SHIFT_RESOLVABLE_STATUSES = new Set(["UPCOMING", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"]);

/**
 * Supervisor/admin cancelling a shift — either outright (the direct "Cancel confirmed shifts"
 * capability, no employee request behind it) or as their chosen response to a pending
 * CHANGE_REQUESTED/CANCELLATION_REQUESTED (see SHIFT_RESOLVABLE_STATUSES above). A reason is
 * always required — "don't delete, cancel with a reason" per the client's own recordkeeping
 * requirement, same standard MissingReturnCommentError already holds timesheet returns to.
 */
export async function cancelShift(actor: CurrentEmployee, shiftId: string, reason: string): Promise<ShiftDTO> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new InvalidShiftError("A reason is required to cancel a shift.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await loadShiftRow(tx, shiftId);
    await assertCanManageShifts(actor, existing.employeeId);
    if (!SHIFT_RESOLVABLE_STATUSES.has(existing.status)) {
      throw new InvalidShiftError("Only an upcoming (or pending-request) shift can be cancelled.");
    }

    const row = await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: trimmedReason,
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_CANCELLED",
      targetId: row.id,
      oldValue: existing.status,
      newValue: "CANCELLED",
      comment: trimmedReason,
    });
    return toDTO(row, "CANCELLED");
  });
}

/**
 * Hands a confirmed shift to a different team member — "Reassign or cancel confirmed shifts."
 * Never edits employeeId in place (see ShiftStatus.REASSIGNED's own doc comment in
 * prisma/schema.prisma): the original row is marked REASSIGNED and kept exactly as it was
 * (date/time/note/history intact), and a brand-new Shift row is created for the new employee,
 * linked back via reassignedFromShiftId — the same "create a new record, never silently rewrite
 * an old one" convention every other table in this schema already follows.
 */
export async function reassignShift(
  actor: CurrentEmployee,
  shiftId: string,
  newEmployeeId: string,
  reason?: string
): Promise<ShiftDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await loadShiftRow(tx, shiftId);
    await assertCanManageShifts(actor, existing.employeeId);
    if (!SHIFT_RESOLVABLE_STATUSES.has(existing.status)) {
      throw new InvalidShiftError("Only an upcoming (or pending-request) shift can be reassigned.");
    }
    if (newEmployeeId === existing.employeeId) {
      throw new InvalidShiftError("Choose a different team member to reassign this shift to.");
    }
    const newEmployee = await tx.employee.findUnique({ where: { id: newEmployeeId } });
    if (!newEmployee || newEmployee.deactivatedAt) {
      throw new InvalidShiftError("That team member isn't available to reassign this shift to.");
    }

    const trimmedReason = reason?.trim() || undefined;

    await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: "REASSIGNED",
        changeReason: trimmedReason ?? null,
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    const newShift = await tx.shift.create({
      data: {
        employeeId: newEmployeeId,
        date: existing.date,
        startTime: existing.startTime,
        endTime: existing.endTime,
        note: existing.note,
        createdById: actor.id,
        reassignedFromShiftId: shiftId,
      },
      include: SHIFT_INCLUDE,
    });

    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_REASSIGNED",
      targetId: shiftId,
      oldValue: existing.employeeId,
      newValue: newEmployeeId,
      comment: trimmedReason,
    });

    return toDTO(newShift, deriveShiftDisplayStatus(newShift, false));
  });
}

// ---------------------------------------------------------------------------
// Phase 2 — Request Shift Change / Request Cancellation (client spec, Sept 2026)
// ---------------------------------------------------------------------------
//
// "Once availability is approved and becomes a confirmed shift, the Team Member must not be
// able to edit or delete it directly. Instead, provide: Request Shift Change, Request
// Cancellation. The Team Member must include a reason and may propose a new date or time. The
// original shift must remain visible with a 'Change Requested' or 'Cancellation Requested'
// status until a Supervisor or Admin responds." The two functions below are the team member's
// own half of that — both run under the ACTOR'S OWN identity via withRlsContext, so the new
// shift_self_request RLS policy (prisma/rls.sql) is what actually stops this from being
// exploitable even if the ownership check below were ever removed by mistake — the same
// belt-and-suspenders shape every other mutation in this file already uses.

export interface RequestShiftChangeInput {
  reason: string;
  requestedDate?: string;
  requestedStartTime?: string;
  requestedEndTime?: string;
}

/** Team member requesting a change to one of their OWN upcoming confirmed shifts. A proposed
 *  date/time is optional (the spec says the team member "may propose a new date or time," not
 *  must) — but if any one of the three is given, all three are required together, since a
 *  half-specified proposal isn't something a supervisor could actually approve as-is. */
export async function requestShiftChange(actor: CurrentEmployee, shiftId: string, input: RequestShiftChangeInput): Promise<ShiftDTO> {
  const reason = input.reason.trim();
  if (!reason) throw new InvalidShiftError("Tell your supervisor why you need this shift changed.");

  const hasProposal = Boolean(input.requestedDate || input.requestedStartTime || input.requestedEndTime);
  if (hasProposal) {
    if (!input.requestedDate || !input.requestedStartTime || !input.requestedEndTime) {
      throw new InvalidShiftError("Give a full proposed date, start time, and end time, or leave all three blank.");
    }
    assertValidDateTime(input.requestedDate, input.requestedStartTime, input.requestedEndTime);
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await loadShiftRow(tx, shiftId);
    if (existing.employeeId !== actor.id) throw new ForbiddenError();
    if (existing.status !== "UPCOMING") {
      throw new InvalidShiftError("Only an upcoming shift can have a change requested.");
    }

    const row = await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: "CHANGE_REQUESTED",
        changeReason: reason,
        requestedDate: input.requestedDate ?? null,
        requestedStartTime: input.requestedStartTime ?? null,
        requestedEndTime: input.requestedEndTime ?? null,
        requestedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        reviewComment: null,
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_CHANGE_REQUESTED",
      targetId: row.id,
      oldValue: `${existing.date} ${existing.startTime}-${existing.endTime}`,
      newValue: hasProposal ? `${input.requestedDate} ${input.requestedStartTime}-${input.requestedEndTime}` : undefined,
      comment: reason,
    });
    return toDTO(row, "CHANGE_REQUESTED");
  });
}

/** Team member requesting their own upcoming shift be cancelled outright — same shape as
 *  requestShiftChange, just no proposed date/time to carry. */
export async function requestShiftCancellation(actor: CurrentEmployee, shiftId: string, reason: string): Promise<ShiftDTO> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new InvalidShiftError("Tell your supervisor why you need this shift cancelled.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await loadShiftRow(tx, shiftId);
    if (existing.employeeId !== actor.id) throw new ForbiddenError();
    if (existing.status !== "UPCOMING") {
      throw new InvalidShiftError("Only an upcoming shift can have a cancellation requested.");
    }

    const row = await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: "CANCELLATION_REQUESTED",
        changeReason: trimmedReason,
        requestedDate: null,
        requestedStartTime: null,
        requestedEndTime: null,
        requestedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        reviewComment: null,
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_CANCELLATION_REQUESTED",
      targetId: row.id,
      oldValue: `${existing.date} ${existing.startTime}-${existing.endTime}`,
      comment: trimmedReason,
    });
    return toDTO(row, "CANCELLATION_REQUESTED");
  });
}

/**
 * Supervisor/admin declining a pending CHANGE_REQUESTED/CANCELLATION_REQUESTED — reverts the
 * shift back to UPCOMING exactly as it was; nothing about date/time/note ever changed while the
 * request was pending, so there's nothing to undo but the status itself. changeReason/
 * requestedDate/etc. are deliberately left in place rather than cleared — a visible record of
 * what was asked for and declined, same as AvailabilitySubmission/PtoRequest keep their own
 * submitted content after a decision instead of erasing it.
 */
export async function denyShiftRequest(actor: CurrentEmployee, shiftId: string, comment?: string): Promise<ShiftDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await loadShiftRow(tx, shiftId);
    await assertCanManageShifts(actor, existing.employeeId);
    if (existing.status !== "CHANGE_REQUESTED" && existing.status !== "CANCELLATION_REQUESTED") {
      throw new InvalidShiftError("This shift has no pending request to decline.");
    }

    const trimmedComment = comment?.trim() || undefined;
    const row = await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: "UPCOMING",
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewComment: trimmedComment ?? null,
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: existing.status === "CHANGE_REQUESTED" ? "SHIFT_CHANGE_DECLINED" : "SHIFT_CANCELLATION_DECLINED",
      targetId: row.id,
      oldValue: existing.status,
      newValue: "UPCOMING",
      comment: trimmedComment,
    });
    return toDTO(row, deriveShiftDisplayStatus(row, false));
  });
}

/**
 * Supervisor/admin approving a pending CANCELLATION_REQUESTED — same terminal effect as
 * cancelShift, just reached from the employee's own request instead of a supervisor acting
 * unprompted. cancelReason falls back to the employee's own stated reason (changeReason) unless
 * the supervisor gives a different one while approving.
 */
export async function approveShiftCancellation(actor: CurrentEmployee, shiftId: string, comment?: string): Promise<ShiftDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await loadShiftRow(tx, shiftId);
    await assertCanManageShifts(actor, existing.employeeId);
    if (existing.status !== "CANCELLATION_REQUESTED") {
      throw new InvalidShiftError("This shift has no pending cancellation request.");
    }

    const trimmedComment = comment?.trim() || undefined;
    const row = await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: trimmedComment || existing.changeReason || "Cancellation requested by team member.",
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewComment: trimmedComment ?? null,
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_CANCELLATION_APPROVED",
      targetId: row.id,
      oldValue: "CANCELLATION_REQUESTED",
      newValue: "CANCELLED",
      comment: trimmedComment,
    });
    return toDTO(row, "CANCELLED");
  });
}

export interface ApproveShiftChangeInput {
  date?: string;
  startTime?: string;
  endTime?: string;
  comment?: string;
}

/**
 * Supervisor/admin approving a pending CHANGE_REQUESTED. Defaults to the employee's own
 * proposed date/time when they gave one; a supervisor may also override with a different final
 * date/time right here — covers both the "employee just asked for a change, didn't propose
 * specifics" case (a bare request with no requestedDate/etc. — the supervisor must supply the
 * final time then) and the spec's own "Change the shift time" as a response to a request,
 * without a second round trip.
 */
export async function approveShiftChange(actor: CurrentEmployee, shiftId: string, input: ApproveShiftChangeInput): Promise<ShiftDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await loadShiftRow(tx, shiftId);
    await assertCanManageShifts(actor, existing.employeeId);
    if (existing.status !== "CHANGE_REQUESTED") {
      throw new InvalidShiftError("This shift has no pending change request.");
    }

    const finalDate = input.date ?? existing.requestedDate;
    const finalStart = input.startTime ?? existing.requestedStartTime;
    const finalEnd = input.endTime ?? existing.requestedEndTime;
    if (!finalDate || !finalStart || !finalEnd) {
      throw new InvalidShiftError("Choose a final date, start time, and end time to approve this change.");
    }
    assertValidDateTime(finalDate, finalStart, finalEnd);

    const trimmedComment = input.comment?.trim() || undefined;
    const row = await tx.shift.update({
      where: { id: shiftId },
      data: {
        status: "UPCOMING",
        date: finalDate,
        startTime: finalStart,
        endTime: finalEnd,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewComment: trimmedComment ?? null,
      },
      include: SHIFT_INCLUDE,
    });
    await writeShiftAuditLog(tx, {
      actorId: actor.id,
      action: "SHIFT_CHANGE_APPROVED",
      targetId: row.id,
      oldValue: `${existing.date} ${existing.startTime}-${existing.endTime}`,
      newValue: `${finalDate} ${finalStart}-${finalEnd}`,
      comment: trimmedComment,
    });
    return toDTO(row, deriveShiftDisplayStatus(row, false));
  });
}
