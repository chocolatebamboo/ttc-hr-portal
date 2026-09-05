import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import type { AdminAvailabilityDTO, AvailabilityDTO, AvailabilityStatus, AvailabilitySlot, CurrentEmployee } from "@/types";

/** Hand-declared rather than importing Prisma's generated EmployeeAvailability type — same
 *  convention src/lib/employees-admin.ts's EmployeeWithRelations follows, so this file doesn't
 *  depend on the generated client's exact shape beyond what toDTO actually reads. */
type AvailabilityRow = {
  slots: unknown;
  note: string | null;
  status: AvailabilityStatus;
  submittedAt: Date;
  reviewComment: string | null;
  reviewedAt: Date | null;
};

export class InvalidAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAvailabilityError";
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validates a whole submitted slot list — every entry a real day-of-week and a real
 *  "HH:MM" < "HH:MM" range, at most one slot per day (a second slot for the same day is
 *  almost certainly a mistake, not an intentional split shift, and this keeps the form and
 *  the data model this simple for now). Throws with a message specific enough to show the
 *  team member directly, same as InvalidPtoRequestError elsewhere in this app. */
function assertValidSlots(slots: unknown): asserts slots is AvailabilitySlot[] {
  if (!Array.isArray(slots)) throw new InvalidAvailabilityError("Availability must be a list of days.");
  const seenDays = new Set<number>();
  for (const raw of slots) {
    const slot = raw as Partial<AvailabilitySlot>;
    if (
      typeof slot !== "object" ||
      slot === null ||
      typeof slot.dayOfWeek !== "number" ||
      !Number.isInteger(slot.dayOfWeek) ||
      slot.dayOfWeek < 0 ||
      slot.dayOfWeek > 6
    ) {
      throw new InvalidAvailabilityError("Each day must be a valid day of the week.");
    }
    if (typeof slot.startTime !== "string" || !TIME_RE.test(slot.startTime)) {
      throw new InvalidAvailabilityError("Each available day needs a valid start time.");
    }
    if (typeof slot.endTime !== "string" || !TIME_RE.test(slot.endTime)) {
      throw new InvalidAvailabilityError("Each available day needs a valid end time.");
    }
    if (slot.endTime <= slot.startTime) {
      throw new InvalidAvailabilityError("End time must be after start time.");
    }
    if (seenDays.has(slot.dayOfWeek)) {
      throw new InvalidAvailabilityError("Each day can only appear once.");
    }
    seenDays.add(slot.dayOfWeek);
  }
}

function toDTO(row: AvailabilityRow | null): AvailabilityDTO {
  if (!row) {
    return { exists: false, slots: [], note: null, status: "PENDING", submittedAt: null, reviewComment: null, reviewedAt: null };
  }
  return {
    exists: true,
    slots: row.slots as unknown as AvailabilitySlot[],
    note: row.note,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

/** The signed-in employee's own current availability (or the "nothing submitted yet" shape
 *  above) — GET /api/availability with no employeeId, or with employeeId=self. */
export async function getMyAvailability(actor: CurrentEmployee): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.employeeAvailability.findUnique({ where: { employeeId: actor.id } });
    return toDTO(row);
  });
}

/**
 * Employee submits or edits their own standing weekly pattern — always for themselves, same
 * shape as submitPtoRequest. Upserts the single row (never creates a second one), and always
 * resets status back to PENDING: an edited pattern needs the same sign-off the first one did,
 * so a supervisor never ends up "approving" a version of the week they never actually saw.
 * Any prior decision (reviewedBy/reviewedAt/reviewComment) is cleared for the same reason —
 * those belonged to the version that's no longer live.
 */
export async function submitAvailability(
  actor: CurrentEmployee,
  input: { slots: AvailabilitySlot[]; note?: string }
): Promise<AvailabilityDTO> {
  assertValidSlots(input.slots);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.employeeAvailability.upsert({
      where: { employeeId: actor.id },
      create: {
        employeeId: actor.id,
        slots: input.slots,
        note: input.note?.trim() || null,
        status: "PENDING",
      },
      update: {
        slots: input.slots,
        note: input.note?.trim() || null,
        status: "PENDING",
        submittedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        reviewComment: null,
      },
    });
    return toDTO(row);
  });
}

type Decision = "APPROVED" | "DENIED";

/** Supervisor/HR decides on a team member's submitted availability. Authorization (is the
 *  reviewer actually this employee's supervisor, or HR/Super Admin?) is checked by the
 *  caller (assertCanReviewAvailability) and enforced again here under the REVIEWER's own
 *  identity via withRlsContext, same two-layer shape as decidePtoRequest. */
export async function decideAvailability(
  reviewer: CurrentEmployee,
  employeeId: string,
  decision: Decision,
  comment?: string
): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.employeeAvailability.findUnique({ where: { employeeId } });
    if (!existing || existing.status !== "PENDING") {
      throw new InvalidAvailabilityError('Only a "Pending" availability submission can be decided.');
    }

    const row = await tx.employeeAvailability.update({
      where: { employeeId },
      data: {
        status: decision,
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        reviewComment: comment?.trim() || null,
      },
    });
    return toDTO(row);
  });
}

/** HR-wide availability roster (src/app/(portal)/admin/availability) — admin-only, like
 *  listAdminPto: no new RLS policy needed since is_admin() already grants availability_select
 *  full org-wide read access (prisma/rls.sql). Only ever lists people who've actually
 *  submitted something — someone who never has doesn't show up as a blank row to review. */
export async function listAdminAvailability(actor: CurrentEmployee): Promise<AdminAvailabilityDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.employeeAvailability.findMany({
      include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
      orderBy: [{ status: "asc" }, { submittedAt: "asc" }],
    });

    return rows.map(
      (r: (typeof rows)[number]): AdminAvailabilityDTO => ({
        ...toDTO(r),
        employeeId: r.employeeId,
        employeeName: `${r.employee.preferredName || r.employee.firstName} ${r.employee.lastName}`,
      })
    );
  });
}
