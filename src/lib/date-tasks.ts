import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { assertCanAccessEmployeeRecords, assertCanAssignTasks, assertIsAdmin } from "@/lib/authorization";
import { getSignedDownloadUrl } from "@/lib/storage";
import type { CurrentEmployee, DateTaskDTO } from "@/types";

export class InvalidDateTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDateTaskError";
  }
}

export class DateTaskNotFoundError extends Error {
  constructor(message = "That task couldn't be found.") {
    super(message);
    this.name = "DateTaskNotFoundError";
  }
}

type TaskRow = {
  id: string;
  employeeId: string;
  createdById: string;
  taskDate: string;
  description: string;
  attachmentKey: string | null;
  attachmentName: string | null;
  status: string;
  completedAt: Date | null;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  employee: { firstName: string; lastName: string; preferredName: string | null };
  createdBy: { firstName: string; lastName: string; preferredName: string | null };
  approvedBy: { firstName: string; lastName: string; preferredName: string | null } | null;
};

function nameOf(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

function toDTO(row: TaskRow): DateTaskDTO {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: nameOf(row.employee),
    createdById: row.createdById,
    createdByName: nameOf(row.createdBy),
    taskDate: row.taskDate,
    description: row.description,
    hasAttachment: row.attachmentKey !== null,
    attachmentName: row.attachmentName,
    status: row.status as DateTaskDTO["status"],
    completedAt: row.completedAt?.toISOString() ?? null,
    approvedById: row.approvedById,
    approvedByName: row.approvedBy ? nameOf(row.approvedBy) : null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const TASK_INCLUDE = {
  employee: { select: { firstName: true, lastName: true, preferredName: true } },
  createdBy: { select: { firstName: true, lastName: true, preferredName: true } },
  approvedBy: { select: { firstName: true, lastName: true, preferredName: true } },
} as const;

/**
 * One employee's date tasks, soonest first — self, their supervisor, or an admin, same access
 * rule as listTeamNotes. Backs both that employee's own "Your tasks" dashboard section and an
 * admin/supervisor's per-date task list on TeamAvailabilityCards.
 */
export async function listDateTasks(actor: CurrentEmployee, employeeId: string): Promise<DateTaskDTO[]> {
  await assertCanAccessEmployeeRecords(actor, employeeId);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.dateTask.findMany({
      where: { employeeId },
      include: TASK_INCLUDE,
      orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(toDTO);
  });
}

/** Convenience wrapper for the signed-in employee's own dashboard section — same shape as
 *  listMyAvailability alongside listAdminAvailability in src/lib/availability.ts. */
export async function listMyDateTasks(actor: CurrentEmployee): Promise<DateTaskDTO[]> {
  return listDateTasks(actor, actor.id);
}

/** Every employee's non-approved tasks in one query — admin only, same reasoning as
 *  listAllTeamNoteTopicCounts: used for the dashboard "you have tasks awaiting review" signal
 *  without a per-employee fetch. Approved tasks are left out — once confirmed there's nothing
 *  left for an admin to act on. */
export async function listAllPendingReviewDateTasks(actor: CurrentEmployee): Promise<DateTaskDTO[]> {
  assertIsAdmin(actor);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.dateTask.findMany({
      where: { status: "COMPLETED" },
      include: TASK_INCLUDE,
      orderBy: [{ completedAt: "asc" }],
    });
    return rows.map(toDTO);
  });
}

/** Push a task onto one employee's specific date — admin or that employee's own supervisor
 *  only (assertCanAssignTasks), never the employee themselves. `attachment` is optional — CB,
 *  Sept 2026: "I should be able to choose file or add files into that as well," same one-file-
 *  per-post shape TeamNote messages already use. */
export async function createDateTask(
  actor: CurrentEmployee,
  employeeId: string,
  taskDate: string,
  description: string,
  attachment?: { key: string; name: string }
): Promise<DateTaskDTO> {
  await assertCanAssignTasks(actor, employeeId);

  const trimmed = description.trim();
  if (!trimmed) throw new InvalidDateTaskError("Describe the task before pushing it.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) {
    throw new InvalidDateTaskError("A task needs a specific date.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.dateTask.create({
      data: {
        employeeId,
        createdById: actor.id,
        taskDate,
        description: trimmed,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
      },
      include: TASK_INCLUDE,
    });
    return toDTO(row);
  });
}

/**
 * A short-lived signed URL for one task's attachment — same "resolve under the caller's own
 * identity first, then sign" shape as getTeamNoteAttachmentUrl. Anyone who may already see this
 * task (self, its employee's supervisor, or an admin) may download its attachment; access isn't
 * narrowed to just the admin/supervisor who originally pushed it.
 */
export async function getDateTaskAttachmentUrl(actor: CurrentEmployee, taskId: string): Promise<string> {
  const row: { employeeId: string; attachmentKey: string | null } | null = await withRlsContext(
    { employeeId: actor.id, role: actor.role },
    async (tx) => {
      return tx.dateTask.findUnique({ where: { id: taskId }, select: { employeeId: true, attachmentKey: true } });
    }
  );

  if (!row || !row.attachmentKey) {
    throw new DateTaskNotFoundError();
  }
  await assertCanAccessEmployeeRecords(actor, row.employeeId);

  return getSignedDownloadUrl(row.attachmentKey);
}

async function loadOwnTaskRow(tx: PrismaClient, taskId: string) {
  const row = await tx.dateTask.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!row) throw new DateTaskNotFoundError();
  return row;
}

/** The employee marking their own task done — only the task's own subject, PENDING only.
 *  Admins/supervisors don't complete a task on someone's behalf; they approve it below. */
export async function completeDateTask(actor: CurrentEmployee, taskId: string): Promise<DateTaskDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await loadOwnTaskRow(tx, taskId);
    if (row.employeeId !== actor.id) throw new DateTaskNotFoundError();
    if (row.status !== "PENDING") {
      throw new InvalidDateTaskError("This task has already been marked done.");
    }
    const updated = await tx.dateTask.update({
      where: { id: taskId },
      data: { status: "COMPLETED", completedAt: new Date() },
      include: TASK_INCLUDE,
    });
    return toDTO(updated);
  });
}

/** An admin/supervisor confirming a completed task — mirrors availability/PTO's decide() shape
 *  (submit → review → decide), just with COMPLETED as the "submitted, awaiting decision" state
 *  instead of PENDING. */
export async function approveDateTask(actor: CurrentEmployee, taskId: string): Promise<DateTaskDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await loadOwnTaskRow(tx, taskId);
    await assertCanAssignTasks(actor, row.employeeId);
    if (row.status !== "COMPLETED") {
      throw new InvalidDateTaskError("Only a completed task can be approved.");
    }
    const updated = await tx.dateTask.update({
      where: { id: taskId },
      data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() },
      include: TASK_INCLUDE,
    });
    return toDTO(updated);
  });
}

/** Sends a completed task back to PENDING instead of approving it — CB's "Approve/Deny" pattern
 *  elsewhere always has a way to say "not yet," so this task workflow gets one too rather than
 *  leaving approve as the only exit from COMPLETED. */
export async function reopenDateTask(actor: CurrentEmployee, taskId: string): Promise<DateTaskDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await loadOwnTaskRow(tx, taskId);
    await assertCanAssignTasks(actor, row.employeeId);
    if (row.status !== "COMPLETED") {
      throw new InvalidDateTaskError("Only a completed task can be sent back.");
    }
    const updated = await tx.dateTask.update({
      where: { id: taskId },
      data: { status: "PENDING", completedAt: null },
      include: TASK_INCLUDE,
    });
    return toDTO(updated);
  });
}
