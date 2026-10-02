import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { assertCanAccessEmployeeRecords, assertCanManageShifts, isAdmin, ForbiddenError } from "@/lib/authorization";
import { orgNow, timeToMinutes } from "@/lib/time";
import { writeNotification } from "@/lib/notifications";
import { getAvatarPublicUrl } from "@/lib/storage";
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
      jobTitle: true,
      departmentId: true,
      department: { select: { name: true } },
      avatarStorageKey: true,
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
    jobTitle: string;
    departmentId: string | null;
    department: { name: string } | null;
    avatarStorageKey: string | null;
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
    employeeJobTitle: row.employee.jobTitle,
    createdById: row.createdById,
    createdByName: nameOf(row.createdBy),
    reviewedByName: row.reviewedBy ? nameOf(row.reviewedBy) : null,
    employeeAvatarUrl: row.employee.avatarStorageKey ? getAvatarPublicUrl(row.employee.avatarStorageKey) : null,
  };
}

/**
 * Hotfix (Sept 2026): switched from tx.auditLog.create() to createMany() — same bug, same fix,
 * as src/lib/audit-log.ts's shared writeAuditLog() (see that file's doc comment for the full
 * mechanism: create() does INSERT ... RETURNING, RETURNING is subject to audit_log_select
 * (`is_admin()`, prisma/rls.sql) not just the insert with-check, so any NON-admin actor — a
 * SUPERVISOR approving/denying/cancelling/reassigning a shift, which is most of what this
 * function is called for — failed the RETURNING re-check and rolled back the whole shift
 * action with the generic "Something went wrong" error. This function is a separate, older,
 * shift-specific copy of that same helper (see its own doc comment above) that predates the
 * shared one and was missed when the shared one got fixed. createMany() never issues
 * RETURNING, so only audit_log_insert's `with check (true)` applies — same row, same
 * admin-only read access afterward, just no attempt to hand it back to a non-admin writer who
 * was never allowed to read AuditLog in the first place. Confirmed directly against the live
 * database (both the failure and the fix) before shipping this.
 */
async function writeShiftAuditLog(
  tx: PrismaClient,
  params: { actorId: string; action: string; targetId: string; oldValue?: string; newValue?: string; comment?: string }
): Promise<void> {
  await tx.auditLog.createMany({
    data: [
      {
        actorId: params.actorId,
        action: params.action,
        targetType: "Shift",
        targetId: params.targetId,
        oldValue: params.oldValue ?? null,
        newValue: params.newValue ?? null,
