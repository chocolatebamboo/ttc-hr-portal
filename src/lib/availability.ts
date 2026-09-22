import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { todayDateKey } from "@/lib/time";
import { writeAuditLog } from "@/lib/audit-log";
import { writeNotification } from "@/lib/notifications";
import { dismiss as dismissKey, listDismissedKeys } from "@/lib/dashboard-dismissals";
import { Prisma } from "@prisma/client";
import type {
  AdminAvailabilityDTO,
  AvailabilityDTO,
  AvailabilityDateDecision,
  AvailabilityStatus,
  AvailabilitySlot,
  CurrentEmployee,
} from "@/types";

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
  adjustedSlots: unknown;
  dateDecisions: unknown;
};

/** Every entry in `slots`, defaulted to PENDING — what a brand-new submission's dateDecisions
 *  starts as (submitAvailability), and the fallback for any row created before this column
 *  existed (dateDecisions is null in the database). Keeping this derivation in one place means
 *  an old row behaves exactly like a fresh one: nothing decided per-date yet, bulk actions still
 *  fully available. */
function defaultDateDecisions(slots: AvailabilitySlot[]): AvailabilityDateDecision[] {
  return slots.map((s) => ({ date: s.date, status: "PENDING" as const, decidedAt: null, decidedById: null, comment: null }));
}

/** Reads a row's dateDecisions back as real entries, falling back to defaultDateDecisions for a
 *  null column (pre-migration rows) or a length mismatch (shouldn't happen in practice, but a
 *  submission's own `slots` is always the source of truth for which dates exist). Exported for
 *  src/lib/shifts.ts's convertAvailabilityDateToShift, which needs to check one specific date's
 *  own decision now that a date can be individually approved while the submission as a whole is
 *  still Pending. */
export function readDateDecisions(slots: AvailabilitySlot[], raw: unknown): AvailabilityDateDecision[] {
  if (Array.isArray(raw) && raw.length === slots.length) {
    return raw as AvailabilityDateDecision[];
  }
  return defaultDateDecisions(slots);
}

/** True once every date has moved off PENDING — the point at which a submission decided
 *  entirely date-by-date reaches the same "fully reviewed" terminal point a bulk decide reaches
 *  immediately. */
function allDatesDecided(decisions: AvailabilityDateDecision[]): boolean {
  return decisions.every((d) => d.status !== "PENDING");
}

/** The submission-wide status once every date has been individually decided — APPROVED if the
 *  reviewer approved at least one date, DENIED only if every single date was denied. Matches
 *  decideAvailability's own two terminal outcomes, so "decide the whole thing at once" and
 *  "decide it one date at a time" land on the same status vocabulary either way. */
function aggregateStatus(decisions: AvailabilityDateDecision[]): "APPROVED" | "DENIED" {
  return decisions.some((d) => d.status === "APPROVED") ? "APPROVED" : "DENIED";
}

/** Whether any date has already been individually decided — once true, this submission is "in
 *  per-date mode" and the whole-submission bulk actions (decideAvailability,
 *  requestAvailabilityAdjustment) step aside until Undo resets it. See dateDecisions' own doc
 *  comment in prisma/schema.prisma for the full either/or reasoning. */
function isInPerDateMode(decisions: AvailabilityDateDecision[]): boolean {
  return decisions.some((d) => d.status !== "PENDING");
}

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
export function assertValidSlots(slots: unknown): asserts slots is AvailabilitySlot[] {
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
  const slots = row.slots as unknown as AvailabilitySlot[];
  return {
    id: row.id,
    slots,
    note: row.note,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    adjustedSlots: row.adjustedSlots ? (row.adjustedSlots as unknown as AvailabilitySlot[]) : null,
    dateDecisions: readDateDecisions(slots, row.dateDecisions),
  };
}

/** The signed-in employee's own submissions, newest first — every one ever submitted, kept as
 *  a real history rather than one row that gets overwritten (CB, Sept 2026: "we will approve
 *  it so that we have a record on our side"). */
export async function listMyAvailability(actor: CurrentEmployee): Promise<AvailabilityDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.availabilitySubmission.findMany({
      // Correction brief #10 (Sept 2026): REMOVED is an admin cleanup status, not a decision the
      // employee needs to see reflected in their own history — see REMOVED's own doc comment in
      // prisma/schema.prisma. Excluded here the same way listAvailabilityForEmployee and
      // listAdminAvailability exclude it below.
      where: { employeeId: actor.id, status: { not: "REMOVED" } },
      orderBy: { submittedAt: "desc" },
    });

    // CB, Sept 2026, two-step approval workflow: an Approved submission doesn't mean "done" from
    // the team member's own seat until a task's actually been pushed for it — that's what
    // confirms the shift. Gather every date this employee has an APPROVED decision on, across
    // every submission, and check which of those dates already have a real (non-cancelled)
    // Shift, in one pass rather than a query per row.
    const approvedDates = new Set<string>();
    for (const row of rows) {
      if (row.status !== "APPROVED") continue;
      const slots = row.slots as unknown as AvailabilitySlot[];
      for (const decision of readDateDecisions(slots, row.dateDecisions)) {
        if (decision.status === "APPROVED") approvedDates.add(decision.date);
      }
    }
    const shiftedDates = new Set(
      approvedDates.size === 0
        ? []
        : (
            await tx.shift.findMany({
              where: { employeeId: actor.id, date: { in: [...approvedDates] }, status: { not: "CANCELLED" } },
              select: { date: true },
            })
          ).map((s) => s.date)
    );

    return rows.map((row) => {
      const dto = toDTO(row);
      if (row.status === "APPROVED") {
        dto.awaitingTask = dto.dateDecisions.some(
          (d) => d.status === "APPROVED" && !shiftedDates.has(d.date)
        );
      }
      return dto;
    });
  });
}

/** A supervisor/HR reviewing one direct report's submissions (TeamAvailabilitySection) — that
 *  employee's full history, newest first. Authorization (is the caller actually allowed to see
 *  this employee's records?) is the caller's job (assertCanAccessEmployeeRecords), same as
 *  GET /api/pto/requests?employeeId=. */
export async function listAvailabilityForEmployee(actor: CurrentEmployee, employeeId: string): Promise<AvailabilityDTO[]> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.availabilitySubmission.findMany({
      // Correction brief #10 (Sept 2026): same REMOVED exclusion listMyAvailability applies —
      // a supervisor/admin drilling into one employee's history shouldn't see admin cleanup
      // noise here either.
      where: { employeeId, status: { not: "REMOVED" } },
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
        dateDecisions: defaultDateDecisions(input.slots) as unknown as Prisma.InputJsonValue,
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

/**
 * Employee removes ONE date out of one of their own multi-date submissions — CB, Sept 2026:
 * "if you select multiple days and we have different times... if I click on one of the dates
 * and I say clear... it deletes all of them that I selected. It should only be one at a time."
 * "Clear this submission" (cancelAvailabilitySubmission) stays for when she genuinely wants to
 * drop the whole batch at once; this is the one-date-at-a-time counterpart. Same eligibility as
 * cancelAvailabilitySubmission — a Pending or Denied submission only, never Approved. Removing
 * the LAST remaining date is just cancelAvailabilitySubmission by another name: same CANCELLED
 * outcome, so the date goes right back to being selectable either way rather than leaving a
 * submission with an empty slots array sitting around.
 */
export async function removeAvailabilityDate(
  actor: CurrentEmployee,
  submissionId: string,
  date: string
): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.employeeId !== actor.id) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    if (existing.status !== "PENDING" && existing.status !== "DENIED") {
      throw new InvalidAvailabilityError('Only a "Pending" or "Denied" submission can be cleared.');
    }

    const slots = existing.slots as unknown as AvailabilitySlot[];
    const remaining = slots.filter((s) => s.date !== date);
    if (remaining.length === slots.length) {
      throw new InvalidAvailabilityError("That date isn't part of this submission.");
    }

    const row =
      remaining.length === 0
        ? await tx.availabilitySubmission.update({ where: { id: submissionId }, data: { status: "CANCELLED" } })
        : await tx.availabilitySubmission.update({
            where: { id: submissionId },
            data: { slots: remaining as unknown as Prisma.InputJsonValue },
          });
    return toDTO(row);
  });
}

/**
 * Admin/supervisor removes ONE date out of a team member's Pending or Denied request — the
 * reviewer-side counterpart to removeAvailabilityDate above, same one-date-at-a-time shape and
 * same PENDING/DENIED-only eligibility, but gated by assertCanReviewAvailability (checked by the
 * caller, same pattern as decideAvailabilityDate) instead of "this is my own submission." CB,
 * Sept 2026: a quick way to trim one date off a multi-date request without a full Deny or
 * opening the per-date panel, tucked behind an Edit/Done toggle on the card so it's opt-in, not
 * sitting there by default. Drops that date's entry out of dateDecisions too, same as the slots
 * array, so a later per-date decide never trips over a decision row for a date that's gone.
 */
export async function removeAvailabilityDateForReview(
  reviewer: CurrentEmployee,
  submissionId: string,
  date: string
): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    if (existing.status !== "PENDING" && existing.status !== "DENIED") {
      throw new InvalidAvailabilityError('Only a "Pending" or "Denied" request can have a date removed.');
    }

    const slots = existing.slots as unknown as AvailabilitySlot[];
    const remaining = slots.filter((s) => s.date !== date);
    if (remaining.length === slots.length) {
      throw new InvalidAvailabilityError("That date isn't part of this request.");
    }

    const remainingDecisions = readDateDecisions(slots, existing.dateDecisions).filter((d) => d.date !== date);

    const row =
      remaining.length === 0
        ? await tx.availabilitySubmission.update({ where: { id: submissionId }, data: { status: "CANCELLED" } })
        : await tx.availabilitySubmission.update({
            where: { id: submissionId },
            data: {
              slots: remaining as unknown as Prisma.InputJsonValue,
              dateDecisions: remainingDecisions as unknown as Prisma.InputJsonValue,
            },
          });
    return toDTO(row);
  });
}

/**
 * Employee permanently removes one of their own CANCELLED submissions — CB, Sept 2026: "the
 * deleting isn't working on these," pointing at old Cancelled entries piling up in the
 * submissions preview next to the calendar. Same Cancelled-only rule as deletePtoRequest
 * (src/lib/pto-actions.ts): a Pending, Denied, or Approved record still means something (still
 * awaiting a decision, or a real decision that was made), so only a status the employee
 * themselves already withdrew is ever eligible to disappear for good. No related rows worth
 * preserving for a submission nobody's acting on anymore — its own shift-reminder rows cascade
 * per the schema.
 */
export async function deleteAvailabilitySubmission(actor: CurrentEmployee, submissionId: string): Promise<void> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.employeeId !== actor.id) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    if (existing.status !== "CANCELLED") {
      throw new InvalidAvailabilityError('Only a "Cancelled" submission can be deleted.');
    }
    await tx.availabilitySubmission.delete({ where: { id: submissionId } });
  });
}

type Decision = "APPROVED" | "DENIED";

/** Supervisor/HR decides on the WHOLE submission at once — "I have the option to approve
 *  everything at one time." Authorization (is the reviewer actually this employee's supervisor,
 *  or HR/Super Admin?) is checked by the caller (assertCanReviewAvailability, using the
 *  submission's employeeId) and enforced again here under the REVIEWER's own identity via
 *  withRlsContext, same two-layer shape as decidePtoRequest. Only available while nothing on
 *  this submission has been decided date-by-date yet (dateDecisions' own doc comment in
 *  prisma/schema.prisma) — once decideAvailabilityDate below has touched even one date, this
 *  throws instead of silently overriding whatever's already been decided; the reviewer finishes
 *  the remaining dates individually, or calls undecideAvailability first to start over. */
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
    const slots = existing.slots as unknown as AvailabilitySlot[];
    const decisions = readDateDecisions(slots, existing.dateDecisions);
    if (isInPerDateMode(decisions)) {
      throw new InvalidAvailabilityError(
        "Some dates on this request have already been decided individually — finish the rest one at a time, or Undo first to start over."
      );
    }

    const decidedDates: AvailabilityDateDecision[] = decisions.map((d) => ({
      ...d,
      status: decision,
      decidedAt: new Date().toISOString(),
      decidedById: reviewer.id,
      comment: comment?.trim() || null,
    }));

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: {
        status: decision,
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        reviewComment: comment?.trim() || null,
        dateDecisions: decidedDates as unknown as Prisma.InputJsonValue,
      },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: decision === "APPROVED" ? "AVAILABILITY_APPROVED" : "AVAILABILITY_DENIED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: "PENDING",
      newValue: decision,
      comment: comment?.trim() || undefined,
    });
    await writeNotification(tx, {
      recipientId: existing.employeeId,
      type: decision === "APPROVED" ? "AVAILABILITY_APPROVED" : "AVAILABILITY_DENIED",
      title: decision === "APPROVED" ? "Your availability was approved" : "Your availability was denied",
      body: comment?.trim() || undefined,
      targetType: "AvailabilitySubmission",
      targetId: row.id,
    });
    return toDTO(row);
  });
}

/**
 * Supervisor/HR decides on ONE date within a submission — "you have to approve each thing, like
 * each date one at a time." The either/or counterpart to decideAvailability above: available
 * only while this specific date is still PENDING (an already-decided date needs Undo first, same
 * as the whole-submission path). The submission's own `status` stays PENDING until every date has
 * been individually decided, at which point it's stamped to the same aggregate outcome a bulk
 * decide would reach (aggregateStatus) — reviewedById/reviewedAt/reviewComment are set then too,
 * matching decideAvailability's own shape, but reviewComment intentionally reflects only that
 * LAST date's comment (each date already carries its own comment in dateDecisions; the
 * submission-level field is a legacy single slot, not a place to concatenate several).
 */
export async function decideAvailabilityDate(
  reviewer: CurrentEmployee,
  submissionId: string,
  date: string,
  decision: Decision,
  comment?: string
): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.status !== "PENDING") {
      throw new InvalidAvailabilityError('Only a "Pending" submission can be decided.');
    }
    const slots = existing.slots as unknown as AvailabilitySlot[];
    const decisions = readDateDecisions(slots, existing.dateDecisions);
    const index = decisions.findIndex((d) => d.date === date);
    if (index === -1) {
      throw new InvalidAvailabilityError("That date isn't part of this submission.");
    }
    if (decisions[index].status !== "PENDING") {
      throw new InvalidAvailabilityError("This date has already been decided.");
    }

    const trimmedComment = comment?.trim() || null;
    const nextDecisions = decisions.slice();
    nextDecisions[index] = {
      ...nextDecisions[index],
      status: decision,
      decidedAt: new Date().toISOString(),
      decidedById: reviewer.id,
      comment: trimmedComment,
    };
    const nowFullyDecided = allDatesDecided(nextDecisions);

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: {
        dateDecisions: nextDecisions as unknown as Prisma.InputJsonValue,
        ...(nowFullyDecided
          ? {
              status: aggregateStatus(nextDecisions),
              reviewedById: reviewer.id,
              reviewedAt: new Date(),
              reviewComment: trimmedComment,
            }
          : {}),
      },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: decision === "APPROVED" ? "AVAILABILITY_DATE_APPROVED" : "AVAILABILITY_DATE_DENIED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: date,
      newValue: decision,
      comment: trimmedComment ?? undefined,
    });
    await writeNotification(tx, {
      recipientId: existing.employeeId,
      type: decision === "APPROVED" ? "AVAILABILITY_APPROVED" : "AVAILABILITY_DENIED",
      title: decision === "APPROVED" ? `Your ${date} availability was approved` : `Your ${date} availability was denied`,
      body: trimmedComment ?? undefined,
      targetType: "AvailabilitySubmission",
      targetId: row.id,
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
    if (
      !existing ||
      (existing.status !== "APPROVED" && existing.status !== "DENIED" && existing.status !== "ADJUSTMENT_REQUESTED")
    ) {
      throw new InvalidAvailabilityError('Only an "Approved," "Denied," or "Adjustment Requested" submission can be reopened.');
    }

    const slots = existing.slots as unknown as AvailabilitySlot[];
    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: {
        status: "PENDING",
        reviewedById: null,
        reviewedAt: null,
        reviewComment: null,
        adjustedSlots: Prisma.JsonNull,
        // Reopening a decision — bulk or date-by-date — restarts from a clean slate, same as a
        // brand-new submission, so the reviewer isn't left with some dates still marked decided
        // underneath a Pending status.
        dateDecisions: defaultDateDecisions(slots) as unknown as Prisma.InputJsonValue,
      },
    });
    return toDTO(row);
  });
}
