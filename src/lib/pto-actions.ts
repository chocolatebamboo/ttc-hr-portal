import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
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

/** GET /api/admin/pto — a Pending queue HR needs to act on, and everything already Decided
 *  (Approved or Denied), most recent 200 by reviewedAt. Same pending/decided shape
 *  listAdminAvailability uses. */
export async function listAdminPto(actor: CurrentEmployee): Promise<AdminPtoSummaryDTO> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const [pending, decided] = await Promise.all([
      tx.ptoRequest.findMany({
        where: { status: "PENDING" },
        include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      tx.ptoRequest.findMany({
        where: { status: { in: ["APPROVED", "DENIED"] } },
        include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { reviewedAt: "desc" },
        take: 200,
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

    return { pending: pending.map(toDTO), decided: decided.map(toDTO) };
  });
}
