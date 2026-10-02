import { withRlsContext } from "@/lib/db";
import { isAdmin, canAccessPtoManagement, ForbiddenError } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit-log";
import { writeNotification } from "@/lib/notifications";
import { getAvatarPublicUrl } from "@/lib/storage";
import type { AdminPtoRequestDTO, AdminPtoSummaryDTO, CurrentEmployee } from "@/types";

export class InvalidPtoRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPtoRequestError";
  }
}

export interface PtoRequestInput {
  type: "VACATION" | "SICK" | "PERSONAL" | "OTHER_APPROVED_LEAVE";
  startDate: Date;
  endDate: Date;
  hours: number;
  reason?: string;
}

export async function submitPtoRequest(actor: CurrentEmployee, input: PtoRequestInput) {
  if (input.endDate < input.startDate) {
    throw new InvalidPtoRequestError("End date must be on or after the start date.");
  }
  if (!(input.hours > 0)) {
    throw new InvalidPtoRequestError("Hours must be greater than zero.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.ptoRequest.create({
      data: {
        employeeId: actor.id,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        hours: input.hours,
        reason: input.reason?.trim() || null,
        status: "PENDING",
      },
    })
  );
}

export async function cancelPtoRequest(actor: CurrentEmployee, requestId: string) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.ptoRequest.findUnique({ where: { id: requestId } });
    if (!existing || existing.employeeId !== actor.id) {
      throw new InvalidPtoRequestError("Request not found.");
    }
    if (existing.status !== "PENDING") {
      throw new InvalidPtoRequestError('Only a "Pending" request can be cancelled.');
    }
    return tx.ptoRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
  });
}

/**
 * Permanently removes one of the signed-in employee's own already-closed-out PTO requests —
 * CB, round five, circling old "Cancelled" entries on the dashboard's Time off list: "I should
 * be able to delete certain things." Distinct from cancelPtoRequest just above (which sets a
 * still-Pending request to Cancelled and keeps the row around) — this is a real delete, and
 * only once a request is already Cancelled, since that's the one status with nothing left for
 * anyone — the employee, a supervisor, HR — to still act on or refer back to.
 */
export async function deletePtoRequest(actor: CurrentEmployee, requestId: string): Promise<void> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.ptoRequest.findUnique({ where: { id: requestId } });
    if (!existing || existing.employeeId !== actor.id) {
      throw new InvalidPtoRequestError("Request not found.");
    }
    if (existing.status !== "CANCELLED") {
      throw new InvalidPtoRequestError('Only a "Cancelled" request can be deleted.');
    }
    await tx.ptoRequest.delete({ where: { id: requestId } });
  });
}

type Decision = "APPROVED" | "DENIED";

export async function decidePtoRequest(
  reviewer: CurrentEmployee,
  requestId: string,
  decision: Decision,
  comment?: string
) {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.ptoRequest.findUnique({ where: { id: requestId } });
    if (!existing || existing.status !== "PENDING") {
      throw new InvalidPtoRequestError('Only a "Pending" request can be decided.');
    }

    const row = await tx.ptoRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        reviewComment: comment?.trim() || null,
      },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: decision === "APPROVED" ? "PTO_APPROVED" : "PTO_DENIED",
      targetType: "PtoRequest",
      targetId: row.id,
      oldValue: "PENDING",
      newValue: decision,
      comment: comment?.trim() || undefined,
    });
    await writeNotification(tx, {
      recipientId: existing.employeeId,
      type: decision === "APPROVED" ? "PTO_APPROVED" : "PTO_DENIED",
      title: decision === "APPROVED" ? "Your PTO request was approved" : "Your PTO request was denied",
      body: comment?.trim() || undefined,
      targetType: "PtoRequest",
      targetId: row.id,
    });
    return row;
  });
}

/**
 * Adds or replaces the reviewer's note on an already-decided PTO request, without touching the
 * decision itself — same "optional, after the fact" comment as availability's
 * addAvailabilityReviewComment, once Deny stopped requiring an explanation up front (CB, Sept
 * 2026: "I shouldn't have to explain myself").
 */
export async function addPtoReviewComment(reviewer: CurrentEmployee, requestId: string, comment: string) {
  const trimmed = comment.trim();
  if (!trimmed) {
    throw new InvalidPtoRequestError("A note is required.");
  }
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.ptoRequest.findUnique({ where: { id: requestId } });
    if (!existing || existing.status === "PENDING") {
      throw new InvalidPtoRequestError("Only a decided request can have a note added.");
    }
    const row = await tx.ptoRequest.update({
      where: { id: requestId },
      data: { reviewComment: trimmed },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: "PTO_COMMENT_ADDED",
      targetType: "PtoRequest",
      targetId: row.id,
      newValue: trimmed,
      comment: trimmed,
    });
    return row;
  });
}

/**
 * Reviewer walks back a decision they already made — same "unapprove" capability as
 * undecideAvailability, for PTO. Puts the request back to Pending and clears the review
 * fields, so it shows up in the Pending queue again exactly as if it had never been decided.
 */
export async function undecidePtoRequest(reviewer: CurrentEmployee, requestId: string) {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.ptoRequest.findUnique({ where: { id: requestId } });
    if (!existing || (existing.status !== "APPROVED" && existing.status !== "DENIED")) {
      throw new InvalidPtoRequestError('Only an "Approved" or "Denied" request can be reopened.');
    }

    return tx.ptoRequest.update({
      where: { id: requestId },
      data: { status: "PENDING", reviewedById: null, reviewedAt: null, reviewComment: null },
    });
  });
}

/**
 * GET /api/admin/pto — a Pending queue HR needs to act on, and everything already Decided
 * (Approved or Denied), most recent 200 by reviewedAt. Same pending/decided shape
 * listAdminAvailability uses.
 *
 * Opened to Supervisor too (Oct 2026, CB: "give him Attendance + PTO Management for his own
 * team" — see canAccessPtoManagement's own doc comment): `employeeScope` narrows both queries
 * below to the caller's own direct reports, the same explicit belt-and-suspenders filter
 * listAdminAttendance/listCurrentlyClockedIn/getPayrollHoursReport already use rather than
 * leaning on pto_select's RLS policy alone (prisma/rls.sql's pto_select already independently
 * grants a supervisor this same read for their own reports' requests).
 */
export async function listAdminPto(actor: CurrentEmployee): Promise<AdminPtoSummaryDTO> {
  if (!canAccessPtoManagement(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    // reviewedBy included alongside employee (Sept 2026, CB: "I like the fact that it has a
    // person who approved it") — PtoRequest already has this relation in prisma/schema.prisma
    // (unlike Availability's per-date decisions, which live in a JSON column and need their own
    // resolveReviewerNames pass), so a direct include is all this needs, pending rows included
    // even though theirs is always null — simpler than branching the include per query.
    const reviewerSelect = { select: { firstName: true, lastName: true, preferredName: true } } as const;
    // Oct 2026 (CB: "also make sure the profile pictures are consistant if they changed it
    // throughout") — shared by both queries below rather than repeated inline, now that it also
    // carries avatarStorageKey for employeeAvatarUrl.
    const employeeSelect = {
      select: { firstName: true, lastName: true, preferredName: true, avatarStorageKey: true },
    } as const;
    const employeeScope = isAdmin(actor) ? {} : { employee: { supervisorId: actor.id } };
    const [pending, decided] = await Promise.all([
      tx.ptoRequest.findMany({
        where: { status: "PENDING", ...employeeScope },
        include: {
          employee: employeeSelect,
          reviewedBy: reviewerSelect,
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.ptoRequest.findMany({
        where: { status: { in: ["APPROVED", "DENIED"] }, ...employeeScope },
        include: {
          employee: employeeSelect,
          reviewedBy: reviewerSelect,
        },
        orderBy: { reviewedAt: "desc" },
        take: 200,
      }),
    ]);

    const toDTO = (r: (typeof pending)[number]): AdminPtoRequestDTO => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.employee.preferredName || r.employee.firstName} ${r.employee.lastName}`,
      employeeAvatarUrl: r.employee.avatarStorageKey ? getAvatarPublicUrl(r.employee.avatarStorageKey) : null,
      type: r.type,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      hours: r.hours,
      reason: r.reason,
      status: r.status,
      reviewComment: r.reviewComment,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      reviewedByName: r.reviewedBy
        ? `${r.reviewedBy.preferredName || r.reviewedBy.firstName} ${r.reviewedBy.lastName}`
        : null,
      createdAt: r.createdAt.toISOString(),
    });

    return { pending: pending.map(toDTO), decided: decided.map(toDTO) };
  });
}
