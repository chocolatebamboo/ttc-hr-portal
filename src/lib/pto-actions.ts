import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { todayDateKey } from "@/lib/time";
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

/** Employee submits a new PTO request — always for themselves; status starts Pending. */
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

/** Employee cancels their own request — only while it's still Pending. */
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

type Decision = "APPROVED" | "DENIED";

/**
 * Supervisor/HR decides on a request. Authorization (is the reviewer actually this
 * employee's supervisor, or HR/Super Admin?) is checked by the caller
 * (assertCanReviewTimesheet reused — the relationship is identical to timesheet review) and
 * enforced again here via withRlsContext under the REVIEWER's identity.
 */
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

    return tx.ptoRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        reviewComment: comment?.trim() || null,
      },
    });
  });
}

/**
 * HR-wide PTO dashboard (src/app/(portal)/admin/pto) — admin-only, like listAdminAttendance:
 * no new RLS policy needed since is_admin() already grants pto_select full org-wide read
 * access (prisma/rls.sql). Returns two lists: every still-Pending request (the queue HR needs
 * to act on) and every already-Approved request starting today or later (so HR can see
 * upcoming coverage gaps before they happen, not just the backlog).
 */
export async function listAdminPto(actor: CurrentEmployee): Promise<AdminPtoSummaryDTO> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const today = new Date(`${todayDateKey()}T00:00:00.000Z`);

    const [pending, upcoming] = await Promise.all([
      tx.ptoRequest.findMany({
        where: { status: "PENDING" },
        include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      tx.ptoRequest.findMany({
        where: { status: "APPROVED", endDate: { gte: today } },
        include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { startDate: "asc" },
      }),
    ]);

    const toDTO = (r: (typeof pending)[number]): AdminPtoRequestDTO => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.employee.preferredName || r.employee.firstName} ${r.employee.lastName}`,
      type: r.type,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      hours: r.hours,
      reason: r.reason,
      status: r.status,
      reviewComment: r.reviewComment,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    });

    return { pending: pending.map(toDTO), upcoming: upcoming.map(toDTO) };
  });
}
