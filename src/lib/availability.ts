import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { todayDateKey } from "@/lib/time";
import type { Prisma } from "@prisma/client";
import type { AdminAvailabilityDTO, AvailabilityDTO, AvailabilityStatus, AvailabilitySlot, CurrentEmployee } from "@/types";

/** Hand-declared rather than importing Prisma's generated AvailabilitySubmission type — same
 *  convention src/lib/employees-admin.ts's EmployeeWithRelations follows, so this file doesn't
 *  depend on the generated client's exact shape beyond what toDTO actually reads. */
type AvailabilityRow = {
  id: string;
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validates one submission's slot list — every entry a real "YYYY-MM-DD" date that's today or
 *  later (same floor PTO requests effectively use — there's no point marking yourself available
 *  for a date that's already passed), a real "HH:MM" < "HH:MM" time range, and at most one
 *  entry per date (a second entry for the same date is almost certainly a mistake, not an
 *  intentional split, same reasoning the old per-weekday version used). Throws with a message
 *  specific enough to show the team member directly, same as InvalidPtoRequestError elsewhere. */
function assertValidSlots(slots: unknown): asserts slots is AvailabilitySlot[] {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new InvalidAvailabilityError("Choose at least one date you're available.");
  }
  const today = todayDateKey();
  const seenDates = new Set<string>();
  for (const raw of slots) {
    const slot = raw as Partial<AvailabilitySlot>;
    if (typeof slot !== "object" || slot === null || typeof slot.date !== "string" || !DATE_RE.test(slot.date)) {
      throw new InvalidAvailabilityError("Each entry needs a valid date.");
    }
    if (slot.date < today) {
      throw new InvalidAvailabilityError("Dates must be today or in the future.");
    }
    if (typeof slot.startTime !== "string" || !TIME_RE.test(slot.startTime)) {
      throw new InvalidAvailabilityError("Each date needs a valid start time.");
    }
    if (typeof slot.endTime !== "string" || !TIME_RE.test(slot.endTime)) {
      throw new InvalidAvailabilityError("Each date needs a valid end time.");
    }
    if (slot.endTime <= slot.startTime) {
      throw new InvalidAvailabilityError("End time must be after start time.");
    }
    if (seenDates.has(slot.date)) {
      throw new InvalidAvailabilityError("Each date can only appear once.");
    }
    seenDates.add(slot.date);
  }
}

function toDTO(row: AvailabilityRow): AvailabilityDTO {
  return {
    id: row.id,
    slots: row.slots as unknown as AvailabilitySlot[],
    note: row.note,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

/** The signed-in employee's own submissions, newest first — every one ever submitted, kept as
 *  a real history rather than one row that gets overwritten (CB, Sept 2026: "we will approve
 *  it so that we have a record on our side"). */
export async function listMyAvailability(actor: CurrentEmployee): Promise<AvailabilityDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.availabilitySubmission.findMany({
      where: { employeeId: actor.id },
      orderBy: { submittedAt: "desc" },
    });
    return rows.map(toDTO);
  });
}

/** A supervisor/HR reviewing one direct report's submissions (TeamAvailabilitySection) — that
 *  employee's full history, newest first. Authorization (is the caller actually allowed to see
 *  this employee's records?) is the caller's job (assertCanAccessEmployeeRecords), same as
 *  GET /api/pto/requests?employeeId=. */
export async function listAvailabilityForEmployee(actor: CurrentEmployee, employeeId: string): Promise<AvailabilityDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.availabilitySubmission.findMany({
      where: { employeeId },
      orderBy: { submittedAt: "desc" },
    });
    return rows.map(toDTO);
  });
}

/**
 * Employee submits a brand-new set of specific available dates/times — always for themselves,
 * always a new row (never edits a past submission in place), same as submitPtoRequest. This
 * is what makes the history real: an approved submission stays exactly what was approved, and
 * a changed schedule is a new submission that goes through review again rather than quietly
 * rewriting what a supervisor already signed off on.
 */
export async function submitAvailability(
  actor: CurrentEmployee,
  input: { slots: AvailabilitySlot[]; note?: string }
): Promise<AvailabilityDTO> {
  assertValidSlots(input.slots);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.availabilitySubmission.create({
      data: {
        employeeId: actor.id,
        slots: input.slots as unknown as Prisma.InputJsonValue,
        note: input.note?.trim() || null,
        status: "PENDING",
      },
    });
    return toDTO(row);
  });
}

/**
 * Employee withdraws one of their OWN submissions — while it's still Pending (not yet
 * reviewed), or after it's been Denied. CB, Sept 2026: "I should be able to clear the dates
 * that either I got denied or the dates that I... said I was available... they shouldn't just
 * be set in stone." Deliberately NOT available on an Approved submission — once a supervisor
 * has signed off on it, unwinding it isn't something the employee does unilaterally, same
 * stance cancelPtoRequest (src/lib/pto-actions.ts) already takes for PTO. Sets status to
 * CANCELLED rather than deleting the row, same reasoning: it stays a real record of what was
 * offered and then withdrawn, not erased. No separate authorization check beyond ownership
 * (checked here, and again by RLS under the actor's own identity) — this is a self-service
 * action, not something a supervisor/HR can do on someone else's behalf.
 */
export async function cancelAvailabilitySubmission(actor: CurrentEmployee, submissionId: string): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.employeeId !== actor.id) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    if (existing.status !== "PENDING" && existing.status !== "DENIED") {
      throw new InvalidAvailabilityError('Only a "Pending" or "Denied" submission can be cleared.');
    }

    const row = await tx.availabilitySubmission.update({ where: { id: submissionId }, data: { status: "CANCELLED" } });
    return toDTO(row);
  });
}

type Decision = "APPROVED" | "DENIED";

/** Supervisor/HR decides on one submission. Authorization (is the reviewer actually this
 *  employee's supervisor, or HR/Super Admin?) is checked by the caller
 *  (assertCanReviewAvailability, using the submission's employeeId) and enforced again here
 *  under the REVIEWER's own identity via withRlsContext, same two-layer shape as
 *  decidePtoRequest. */
export async function decideAvailability(
  reviewer: CurrentEmployee,
  submissionId: string,
  decision: Decision,
  comment?: string
): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.status !== "PENDING") {
      throw new InvalidAvailabilityError('Only a "Pending" submission can be decided.');
    }

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
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

/**
 * Reviewer walks back a decision they already made — CB (Sept 2026), on the redesigned admin
 * card view: "I see approved, but I should be able to, like, unapprove it." Puts the
 * submission back to Pending (never CANCELLED — that status means the EMPLOYEE withdrew it,
 * see cancelAvailabilitySubmission; this is the reviewer reopening their own decision) and
 * clears the review fields, so it shows up in the Pending queue again exactly as if it had
 * never been decided, ready to be approved or denied again. Same authorization shape as
 * decideAvailability: the route checks assertCanReviewAvailability first, and this runs under
 * the reviewer's own RLS identity as a second, independent check.
 */
export async function undecideAvailability(reviewer: CurrentEmployee, submissionId: string): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || (existing.status !== "APPROVED" && existing.status !== "DENIED")) {
      throw new InvalidAvailabilityError('Only an "Approved" or "Denied" submission can be reopened.');
    }

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: { status: "PENDING", reviewedById: null, reviewedAt: null, reviewComment: null },
    });
    return toDTO(row);
  });
}

/** Looks up which employee a submission belongs to, without any authorization check of its
 *  own — used by the decide route to resolve the employeeId assertCanReviewAvailability needs
 *  before it can decide whether the caller may act on it at all. Runs under the CALLER's own
 *  RLS identity like everything else here, so a caller with no visibility into this submission
 *  (not its owner, not their supervisor, not admin) gets null back exactly as if it didn't
 *  exist, rather than leaking which employee it belongs to. */
export async function findAvailabilitySubmissionEmployeeId(actor: CurrentEmployee, submissionId: string): Promise<string | null> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const row = await tx.availabilitySubmission.findUnique({ where: { id: submissionId }, select: { employeeId: true } });
    return row?.employeeId ?? null;
  });
}

/** HR-wide availability roster (src/app/(portal)/admin/availability) — admin-only, like
 *  listAdminPto: no new RLS policy needed since is_admin() already grants availability_select
 *  full org-wide read access (prisma/rls.sql). Split into a Pending queue HR needs to act on
 *  and everything already Decided, same shape listAdminPto uses for pending/decided. Decided
 *  is capped to the most recent 200 so this stays one page rather than growing forever. */
export async function listAdminAvailability(
  actor: CurrentEmployee
): Promise<{ pending: AdminAvailabilityDTO[]; decided: AdminAvailabilityDTO[] }> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const [pending, decided] = await Promise.all([
      tx.availabilitySubmission.findMany({
        where: { status: "PENDING" },
        include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { submittedAt: "asc" },
      }),
      tx.availabilitySubmission.findMany({
        where: { status: { not: "PENDING" } },
        include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { reviewedAt: "desc" },
        take: 200,
      }),
    ]);

    const toAdminDTO = (r: (typeof pending)[number]): AdminAvailabilityDTO => ({
      ...toDTO(r),
      employeeId: r.employeeId,
      employeeName: `${r.employee.preferredName || r.employee.firstName} ${r.employee.lastName}`,
    });

    return { pending: pending.map(toAdminDTO), decided: decided.map(toAdminDTO) };
  });
}
