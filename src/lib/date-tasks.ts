import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { assertCanAccessEmployeeRecords, assertCanAssignTasks, assertIsAdmin } from "@/lib/authorization";
import { getSignedDownloadUrl, uploadDateTaskFile } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit-log";
import { writeNotification } from "@/lib/notifications";
import { readDateDecisions } from "@/lib/availability";
import type { AvailabilitySlot, CurrentEmployee, DateTaskCommentDTO, DateTaskDTO } from "@/types";

/**
 * Correction brief (Sept 2026, "Correction & Refinement Brief" #2): "Redesign this area into an
 * actual task-management workflow." See DateTask/DateTaskComment's own doc comments in
 * prisma/schema.prisma for the full lifecycle reasoning (ASSIGNED → IN_PROGRESS →
 * AWAITING_REVIEW → APPROVED/RETURNED) and why per-task comments replace the old standalone
 * per-date TeamNote "Conversation" section.
 */

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

type NameParts = { firstName: string; lastName: string; preferredName: string | null };

type TaskRow = {
  id: string;
  employeeId: string;
  createdById: string;
  taskDate: string;
  title: string;
  description: string;
  attachmentKey: string | null;
  attachmentName: string | null;
  status: string;
  priority: string;
  startedAt: Date | null;
  submittedAt: Date | null;
  approvedById: string | null;
  approvedAt: Date | null;
  returnedById: string | null;
  returnedAt: Date | null;
  returnNote: string | null;
  createdAt: Date;
  employee: NameParts;
  createdBy: NameParts;
  approvedBy: NameParts | null;
  returnedBy: NameParts | null;
  _count: { comments: number };
};

function nameOf(p: NameParts): string {
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
    title: row.title,
    description: row.description,
    hasAttachment: row.attachmentKey !== null,
    attachmentName: row.attachmentName,
    status: row.status as DateTaskDTO["status"],
    priority: row.priority as DateTaskDTO["priority"],
    startedAt: row.startedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedById: row.approvedById,
    approvedByName: row.approvedBy ? nameOf(row.approvedBy) : null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    returnedById: row.returnedById,
    returnedByName: row.returnedBy ? nameOf(row.returnedBy) : null,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    returnNote: row.returnNote,
    commentCount: row._count.comments,
    createdAt: row.createdAt.toISOString(),
  };
}

const TASK_INCLUDE = {
  employee: { select: { firstName: true, lastName: true, preferredName: true } },
  createdBy: { select: { firstName: true, lastName: true, preferredName: true } },
  approvedBy: { select: { firstName: true, lastName: true, preferredName: true } },
  returnedBy: { select: { firstName: true, lastName: true, preferredName: true } },
  _count: { select: { comments: true } },
} as const;

/**
 * One employee's date tasks, soonest first — self, their supervisor, or an admin, same access
 * rule as listTeamNotes. Backs the employee's own "Your tasks" dashboard section and both
 * admin/supervisor and self-service per-date task panels.
 */
export async function listDateTasks(actor: CurrentEmployee, employeeId: string): Promise<DateTaskDTO[]> {
  await assertCanAccessEmployeeRecords(actor, employeeId);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows: TaskRow[] = await tx.dateTask.findMany({
      where: { employeeId },
      include: TASK_INCLUDE,
      orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }],
    });

    // QA pass (Sept 2026), CB: a task shouldn't be visible to the employee it's assigned to
    // until that date's shift is actually confirmed — availability approval is not the same as
    // a confirmed shift (see AvailabilitySubmission.dateDecisions' own doc comment and
    // convertAvailabilityDateToShift in src/lib/shifts.ts), and showing someone a task for a day
    // that could still change would tell them to plan around a shift that isn't real yet. Only
    // applied when the caller is looking at their OWN tasks (actor.id === employeeId) — an
    // admin/supervisor managing tasks from a date's own card (DateTasksPanel) always sees
    // everything they've assigned, confirmed or not, since they're the one deciding what to
    // confirm and needs the full picture to do that. A CANCELLED or REASSIGNED shift doesn't
    // count as "confirmed" — that date is no longer really scheduled for this employee.
    if (actor.id !== employeeId) return rows.map(toDTO);

    const dates = [...new Set(rows.map((r) => r.taskDate))];
    if (dates.length === 0) return [];
    const confirmedShifts: { date: string }[] = await tx.shift.findMany({
      where: { employeeId, date: { in: dates }, status: { notIn: ["CANCELLED", "REASSIGNED"] } },
      select: { date: true },
    });
    const confirmedDates = new Set(confirmedShifts.map((s) => s.date));
    return rows.filter((r) => confirmedDates.has(r.taskDate)).map(toDTO);
  });
}

/** Convenience wrapper for the signed-in employee's own dashboard section — same shape as
 *  listMyAvailability alongside listAdminAvailability in src/lib/availability.ts. */
export async function listMyDateTasks(actor: CurrentEmployee): Promise<DateTaskDTO[]> {
  return listDateTasks(actor, actor.id);
}

/** Every employee's AWAITING_REVIEW tasks in one query — admin only, same reasoning as
 *  listAllTeamNoteTopicCounts: used for an admin "you have tasks awaiting review" signal without
 *  a per-employee fetch. Tasks that are still ASSIGNED/IN_PROGRESS, already APPROVED, or
 *  RETURNED-and-not-yet-resubmitted are left out — none of those need a reviewer's action right
 *  now. */
export async function listAllAwaitingReviewDateTasks(actor: CurrentEmployee): Promise<DateTaskDTO[]> {
  assertIsAdmin(actor);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows: TaskRow[] = await tx.dateTask.findMany({
      where: { status: "AWAITING_REVIEW" },
      include: TASK_INCLUDE,
      orderBy: [{ submittedAt: "asc" }],
    });
    return rows.map(toDTO);
  });
}

/** Create a task on one employee's specific date — admin or that employee's own supervisor only
 *  (assertCanAssignTasks), never the employee themselves. `attachment` is optional, matching
 *  every other one-file-per-post surface in this app (TeamNote, DirectMessage messages). */
export async function createDateTask(
  actor: CurrentEmployee,
  employeeId: string,
  taskDate: string,
  title: string,
  description: string,
  attachment?: { key: string; name: string },
  priority: "NORMAL" | "URGENT" = "NORMAL"
): Promise<DateTaskDTO> {
  await assertCanAssignTasks(actor, employeeId);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  if (!trimmedTitle) throw new InvalidDateTaskError("Give the task a title before assigning it.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) {
    throw new InvalidDateTaskError("A task needs a specific date.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row: TaskRow = await tx.dateTask.create({
      data: {
        employeeId,
        createdById: actor.id,
        taskDate,
        title: trimmedTitle,
        description: trimmedDescription,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
        priority,
      },
      include: TASK_INCLUDE,
    });
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: "DATE_TASK_ASSIGNED",
      targetType: "DateTask",
      targetId: row.id,
      newValue: taskDate,
      comment: trimmedTitle,
    });
    await writeNotification(tx, {
      recipientId: employeeId,
      type: "DATE_TASK_ASSIGNED",
      title: "You have a new task",
      body: trimmedTitle,
      targetType: "DateTask",
      targetId: row.id,
    });

    // CB, Sept 2026, two-step approval workflow, from the real meeting with Daijour: a
    // supervisor approving a date doesn't finish anything by itself — it pings the admin, and
    // it's the admin PUSHING A TASK for that date that actually confirms the shift, in one
    // action, no separate "Confirm as Shift" tap. (That standalone button is intentionally gone
    // from TeamAvailabilityCards — see its own comment.) Same transaction as the task write
    // above, not a call out to convertAvailabilityDateToShift, which opens its own top-level
    // withRlsContext/$transaction — nesting two interactive transactions on the same pooled
    // connection is exactly the kind of thing that can hang under Supabase's connection limits,
    // so this mirrors that function's logic inline against the tx already open here instead.
    const alreadyShifted = await tx.shift.findFirst({
      where: { employeeId, date: taskDate, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (!alreadyShifted) {
      // Deliberately NOT filtered by submission.status === "APPROVED" here: decideAvailabilityDate
      // (deciding one date at a time) leaves the submission's own status at PENDING until every
      // date on it has been individually decided — see aggregateStatus/isInPerDateMode's own doc
      // comments — so a date can be genuinely, individually APPROVED while its parent submission
      // still reads PENDING. Filtering on submission.status would silently skip auto-confirming
      // the shift for exactly that (common) per-date-review path. So this instead looks at every
      // one of the employee's still-live submissions and asks THIS date's own dateDecisions entry
      // whether it's approved — the same per-date truth convertAvailabilityDateToShift itself
      // checks — rather than trusting the submission-level status.
      const candidates = await tx.availabilitySubmission.findMany({
        where: { employeeId, status: { notIn: ["REMOVED", "CANCELLED"] } },
        orderBy: { submittedAt: "desc" },
      });
      let approvedSubmission: (typeof candidates)[number] | undefined;
      let approvedSlot: AvailabilitySlot | undefined;
      for (const candidate of candidates) {
        const slots = candidate.slots as unknown as AvailabilitySlot[];
        const slot = slots.find((s) => s.date === taskDate);
        if (!slot) continue;
        const decision = readDateDecisions(slots, candidate.dateDecisions).find((d) => d.date === taskDate);
        if (decision?.status === "APPROVED") {
          approvedSubmission = candidate;
          approvedSlot = slot;
          break;
        }
      }
      if (approvedSubmission && approvedSlot) {
        const shift = await tx.shift.create({
          data: {
            employeeId,
            date: approvedSlot.date,
            startTime: approvedSlot.startTime,
            endTime: approvedSlot.endTime,
            note: approvedSubmission.note,
            sourceAvailabilitySubmissionId: approvedSubmission.id,
            createdById: actor.id,
          },
        });
        await writeAuditLog(tx, {
          actorId: actor.id,
          action: "SHIFT_CREATED",
          targetType: "Shift",
          targetId: shift.id,
          newValue: `${shift.date} ${shift.startTime}-${shift.endTime} for ${employeeId} (confirmed by task push, from availability ${approvedSubmission.id})`,
        });
        await writeNotification(tx, {
          recipientId: employeeId,
          type: "SHIFT_CREATED",
          title: "You've been scheduled for a new shift",
          body: `${shift.date}, ${shift.startTime}–${shift.endTime}`,
          targetType: "Shift",
          targetId: shift.id,
        });
      }
    }

    return toDTO(row);
  });
}

/** A short-lived signed URL for one task's own attachment — anyone who may already see this
 *  task (self, its employee's supervisor, or an admin) may download it. */
export async function getDateTaskAttachmentUrl(actor: CurrentEmployee, taskId: string): Promise<string> {
  const row: { employeeId: string; attachmentKey: string | null } | null = await withRlsContext(
    { employeeId: actor.id, role: actor.role },
    async (tx) => tx.dateTask.findUnique({ where: { id: taskId }, select: { employeeId: true, attachmentKey: true } })
  );

  if (!row || !row.attachmentKey) {
    throw new DateTaskNotFoundError();
  }
  await assertCanAccessEmployeeRecords(actor, row.employeeId);

  return getSignedDownloadUrl(row.attachmentKey);
}

async function loadOwnTaskRow(tx: PrismaClient, taskId: string): Promise<TaskRow> {
  const row: TaskRow | null = await tx.dateTask.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!row) throw new DateTaskNotFoundError();
  return row;
}

/** The task's own employee marking it started — a purely self-reported signal (brief's
 *  recommended lifecycle lists "In Progress" as its own stop; nothing else gates on it, and
 *  submitDateTask below works directly from ASSIGNED too). Allowed from ASSIGNED or RETURNED —
 *  picking a returned task back up is "starting" it again, same as a fresh assignment. */
export async function startDateTask(actor: CurrentEmployee, taskId: string): Promise<DateTaskDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await loadOwnTaskRow(tx, taskId);
    if (row.employeeId !== actor.id) throw new DateTaskNotFoundError();
    if (row.status !== "ASSIGNED" && row.status !== "RETURNED") {
      throw new InvalidDateTaskError("This task is already in progress or further along.");
    }
    const updated: TaskRow = await tx.dateTask.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
      include: TASK_INCLUDE,
    });
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: "DATE_TASK_STARTED",
      targetType: "DateTask",
      targetId: updated.id,
      oldValue: row.status,
      newValue: "IN_PROGRESS",
    });
    return toDTO(updated);
  });
}

/** The employee submitting their own task for review — only the task's own subject, from
 *  ASSIGNED, IN_PROGRESS, or RETURNED (a returned task may be resubmitted directly, without
 *  necessarily going through startDateTask again first). Admins/supervisors don't submit a task
 *  on someone's behalf; they approve or return it below. */
export async function submitDateTask(actor: CurrentEmployee, taskId: string): Promise<DateTaskDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await loadOwnTaskRow(tx, taskId);
    if (row.employeeId !== actor.id) throw new DateTaskNotFoundError();
    if (row.status !== "ASSIGNED" && row.status !== "IN_PROGRESS" && row.status !== "RETURNED") {
      throw new InvalidDateTaskError("This task has already been submitted or confirmed.");
    }
    const updated: TaskRow = await tx.dateTask.update({
      where: { id: taskId },
      data: { status: "AWAITING_REVIEW", submittedAt: new Date() },
      include: TASK_INCLUDE,
    });
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: "DATE_TASK_SUBMITTED",
      targetType: "DateTask",
      targetId: updated.id,
      oldValue: row.status,
      newValue: "AWAITING_REVIEW",
    });
    return toDTO(updated);
  });
}

/** An admin/supervisor confirming a submitted task — mirrors availability/PTO's decide() shape
 *  (submit → review → decide), with AWAITING_REVIEW as the "submitted, awaiting decision" state. */
export async function approveDateTask(actor: CurrentEmployee, taskId: string): Promise<DateTaskDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await loadOwnTaskRow(tx, taskId);
    await assertCanAssignTasks(actor, row.employeeId);
    if (row.status !== "AWAITING_REVIEW") {
      throw new InvalidDateTaskError("Only a submitted task can be approved.");
    }
    const updated: TaskRow = await tx.dateTask.update({
      where: { id: taskId },
      data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() },
      include: TASK_INCLUDE,
    });
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: "DATE_TASK_APPROVED",
      targetType: "DateTask",
      targetId: updated.id,
      oldValue: "AWAITING_REVIEW",
      newValue: "APPROVED",
    });
    await writeNotification(tx, {
      recipientId: updated.employeeId,
      type: "DATE_TASK_APPROVED",
      title: "A task you submitted was approved",
      body: updated.title,
      targetType: "DateTask",
      targetId: updated.id,
    });
    return toDTO(updated);
  });
}

/** Sends a submitted task back with a note instead of approving it — correction brief #2:
 *  "Return/Reopen with a note." The note is required (an employee needs to know what to fix)
 *  and is also posted as a comment on the task's own thread, so it's visible right alongside
 *  whatever comment/attachment history the task already has, not just in a separate field only
 *  the detail view surfaces. */
export async function returnDateTask(actor: CurrentEmployee, taskId: string, note: string): Promise<DateTaskDTO> {
  const trimmedNote = note.trim();
  if (!trimmedNote) throw new InvalidDateTaskError("Add a note explaining what needs to change.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await loadOwnTaskRow(tx, taskId);
    await assertCanAssignTasks(actor, row.employeeId);
    if (row.status !== "AWAITING_REVIEW") {
      throw new InvalidDateTaskError("Only a submitted task can be sent back.");
    }
    const updated: TaskRow = await tx.dateTask.update({
      where: { id: taskId },
      data: { status: "RETURNED", returnedById: actor.id, returnedAt: new Date(), returnNote: trimmedNote },
      include: TASK_INCLUDE,
    });
    await tx.dateTaskComment.create({
      data: { taskId, authorId: actor.id, body: `Returned: ${trimmedNote}` },
    });
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: "DATE_TASK_RETURNED",
      targetType: "DateTask",
      targetId: updated.id,
      oldValue: "AWAITING_REVIEW",
      newValue: "RETURNED",
      comment: trimmedNote,
    });
    await writeNotification(tx, {
      recipientId: updated.employeeId,
      type: "DATE_TASK_RETURNED",
      title: "A task was sent back to you",
      body: trimmedNote,
      targetType: "DateTask",
      targetId: updated.id,
    });
    return toDTO(updated);
  });
}

// ---------------------------------------------------------------------------
// Task-scoped comments — correction brief #2's replacement for the standalone per-date
// TeamNote "Conversation" section. Same access shape as the task itself (self/supervisor/
// admin), enforced at the app layer here and independently by prisma/rls.sql's
// date_task_comment_select/insert (a subquery on the parent DateTask).
// ---------------------------------------------------------------------------

type CommentRow = {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  attachmentKey: string | null;
  attachmentName: string | null;
  createdAt: Date;
  author: NameParts;
};

function commentToDTO(row: CommentRow): DateTaskCommentDTO {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorId,
    authorName: nameOf(row.author),
    body: row.body,
    hasAttachment: row.attachmentKey !== null,
    attachmentName: row.attachmentName,
    createdAt: row.createdAt.toISOString(),
  };
}

const COMMENT_INCLUDE = {
  author: { select: { firstName: true, lastName: true, preferredName: true } },
} as const;

/** Every comment on one task, oldest first — access is governed by being able to see the parent
 *  task at all (self/supervisor/admin), same as every other field on it. */
export async function listDateTaskComments(actor: CurrentEmployee, taskId: string): Promise<DateTaskCommentDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const task = await tx.dateTask.findUnique({ where: { id: taskId }, select: { employeeId: true } });
    if (!task) throw new DateTaskNotFoundError();
    await assertCanAccessEmployeeRecords(actor, task.employeeId);

    const rows: CommentRow[] = await tx.dateTaskComment.findMany({
      where: { taskId },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(commentToDTO);
  });
}

/** Post a comment on a task — same access rule as reading its comments (self/supervisor/admin;
 *  never a stranger to the task, even an admin looking at someone else's — wait, admins CAN
 *  always access any employee's records here, matching every other DateTask function). Optional
 *  attachment, same one-file-per-post shape as TeamNote/DirectMessage messages. Takes the raw
 *  `file` (rather than a pre-uploaded {key, name}, unlike createDateTask) because the storage key
 *  needs the task's own subject employeeId as its prefix — same convention as
 *  uploadTeamNoteFile's calls in team-notes.ts, which key by the thread's subject, not whoever is
 *  posting — and the route layer doesn't know that id until this function resolves it. The
 *  employeeId lookup+authorization runs in its own short transaction, and the (potentially slow,
 *  external) storage upload happens between transactions rather than inside one — same reasoning
 *  as why every other uploader in this app runs before withRlsContext, not within it. */
export async function addDateTaskComment(
  actor: CurrentEmployee,
  taskId: string,
  body: string,
  file?: File
): Promise<DateTaskCommentDTO> {
  const trimmed = body.trim();
  if (!trimmed && !file) throw new InvalidDateTaskError("Write a comment or attach a file.");

  const task: { employeeId: string } | null = await withRlsContext(
    { employeeId: actor.id, role: actor.role },
    async (tx) => tx.dateTask.findUnique({ where: { id: taskId }, select: { employeeId: true } })
  );
  if (!task) throw new DateTaskNotFoundError();
  await assertCanAccessEmployeeRecords(actor, task.employeeId);

  const attachment = file ? { key: await uploadDateTaskFile(file, task.employeeId), name: file.name } : undefined;

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row: CommentRow = await tx.dateTaskComment.create({
      data: {
        taskId,
        authorId: actor.id,
        body: trimmed,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
      },
      include: COMMENT_INCLUDE,
    });
    return commentToDTO(row);
  });
}

/** A short-lived signed URL for one comment's attachment — same access rule as the comment
 *  thread itself. */
export async function getDateTaskCommentAttachmentUrl(actor: CurrentEmployee, commentId: string): Promise<string> {
  const row: { attachmentKey: string | null; task: { employeeId: string } } | null = await withRlsContext(
    { employeeId: actor.id, role: actor.role },
    async (tx) =>
      tx.dateTaskComment.findUnique({
        where: { id: commentId },
        select: { attachmentKey: true, task: { select: { employeeId: true } } },
      })
  );

  if (!row || !row.attachmentKey) {
    throw new DateTaskNotFoundError();
  }
  await assertCanAccessEmployeeRecords(actor, row.task.employeeId);

  return getSignedDownloadUrl(row.attachmentKey);
}

// Re-exported so API routes don't each need their own import of the raw upload helper —
// mirrors how src/app/api/date-tasks/[id]/route.ts already used uploadDateTaskFile directly
// before this rework; kept as a named export here too for the comments routes' convenience.
export { uploadDateTaskFile };
