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

/**
 * Phase 2 (client spec, Sept 2026): the reviewer's third option besides outright Approve/Deny —
 * "Adjust the proposed time and send it to the team member for confirmation." adjustedSlots must
 * cover the exact same dates as the submission's own `slots` (only the times may differ — the
 * spec says "the proposed TIME," not a different date), same discipline assertValidSlots already
 * enforces for a fresh submission.
 */
export async function requestAvailabilityAdjustment(
  reviewer: CurrentEmployee,
  submissionId: string,
  adjustedSlots: AvailabilitySlot[],
  comment?: string
): Promise<AvailabilityDTO> {
  assertValidSlots(adjustedSlots);

  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.status !== "PENDING") {
      throw new InvalidAvailabilityError('Only a "Pending" submission can have an adjustment requested.');
    }
    const existingSlots = existing.slots as unknown as AvailabilitySlot[];
    if (isInPerDateMode(readDateDecisions(existingSlots, existing.dateDecisions))) {
      throw new InvalidAvailabilityError(
        "Some dates on this request have already been decided individually — Undo first if you want to propose new times for the whole request."
      );
    }

    const originalDates = new Set((existing.slots as unknown as AvailabilitySlot[]).map((s) => s.date));
    const adjustedDates = new Set(adjustedSlots.map((s) => s.date));
    if (originalDates.size !== adjustedDates.size || [...originalDates].some((d) => !adjustedDates.has(d))) {
      throw new InvalidAvailabilityError("The adjusted times must cover the exact same dates that were submitted.");
    }

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: {
        status: "ADJUSTMENT_REQUESTED",
        adjustedSlots: adjustedSlots as unknown as Prisma.InputJsonValue,
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        reviewComment: comment?.trim() || null,
      },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: "AVAILABILITY_ADJUSTMENT_PROPOSED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: "PENDING",
      newValue: "ADJUSTMENT_REQUESTED",
      comment: comment?.trim() || undefined,
    });
    await writeNotification(tx, {
      recipientId: existing.employeeId,
      type: "AVAILABILITY_ADJUSTMENT_PROPOSED",
      title: "Your supervisor proposed different times",
      body: comment?.trim() || undefined,
      targetType: "AvailabilitySubmission",
      targetId: row.id,
    });
    return toDTO(row);
  });
}

/**
 * Team member's response to a pending ADJUSTMENT_REQUESTED — "send it to the team member for
 * confirmation." Accepting makes the adjusted times the real, official ones (status → APPROVED,
 * same terminal state a plain Approve reaches, so everything downstream — converting to a
 * confirmed Shift — works exactly the same way regardless of which path got here). Declining
 * (status → DENIED) leaves the ORIGINAL slots untouched and adjustedSlots in place as the record
 * of what was offered and turned down — matching decideAvailability's own "never erase the
 * submitted content" convention. No separate authorization check beyond ownership (checked here,
 * and again by RLS under the actor's own identity) — this is the submission's own employee
 * responding to a proposal made about THEM, not a supervisor/HR action.
 */
export async function respondToAvailabilityAdjustment(
  actor: CurrentEmployee,
  submissionId: string,
  accept: boolean
): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.employeeId !== actor.id) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    if (existing.status !== "ADJUSTMENT_REQUESTED") {
      throw new InvalidAvailabilityError("This submission has no pending adjustment to respond to.");
    }

    // Accepting/declining a proposed-time adjustment is still a whole-submission outcome (the
    // employee is responding to one proposal covering every date, not deciding dates one at a
    // time), so every dateDecisions entry lands on the same terminal status together — same
    // aggregate shape decideAvailability's bulk path already produces.
    const finalSlots = accept ? (existing.adjustedSlots as unknown as AvailabilitySlot[]) : (existing.slots as unknown as AvailabilitySlot[]);
    const settledDecisions: AvailabilityDateDecision[] = defaultDateDecisions(finalSlots).map((d) => ({
      ...d,
      status: accept ? "APPROVED" : "DENIED",
      decidedAt: new Date().toISOString(),
      decidedById: actor.id,
    }));

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: accept
        ? {
            status: "APPROVED",
            slots: existing.adjustedSlots as unknown as Prisma.InputJsonValue,
            dateDecisions: settledDecisions as unknown as Prisma.InputJsonValue,
          }
        : { status: "DENIED", dateDecisions: settledDecisions as unknown as Prisma.InputJsonValue },
    });
    // Audit-only, no Notification row — Activity History benefits from every reviewable
    // decision being recorded, but this particular one (the team member's own response to a
    // proposal about THEM) has no separate person left to notify: the reviewer who made the
    // proposal can already see the outcome the next time they look at this submission.
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: accept ? "AVAILABILITY_ADJUSTMENT_ACCEPTED" : "AVAILABILITY_ADJUSTMENT_DECLINED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: "ADJUSTMENT_REQUESTED",
      newValue: row.status,
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

/**
 * Correction brief #9 (Sept 2026): "persist dismissal state" for "dismissible notifications and
 * availability records" — a Decided card's own dismiss key, content-derived exactly like
 * dashboard-notifications.ts's "messages:3"-style keys, from fields that only change when this
 * submission is genuinely re-decided: `status` alone isn't enough, since Undo (undecideAvailability,
 * above) can send a card back to Pending and a reviewer can then approve or deny it again with the
 * SAME status as before — `reviewedAt` is reset to null on Undo and stamped fresh on every decide,
 * so folding it into the key means a fresh decision always produces a new, undismissed key even
 * when the outcome (e.g. Approved again) repeats.
 */
function decidedDismissalKey(row: { id: string; status: AvailabilityStatus; reviewedAt: string | null }): string {
  return `availability-decided:${row.id}:${row.status}:${row.reviewedAt ?? ""}`;
}

/** HR-wide availability roster (src/app/(portal)/admin/availability) — admin-only, like
 *  listAdminPto: no new RLS policy needed since is_admin() already grants availability_select
 *  full org-wide read access (prisma/rls.sql). Split into a Pending queue HR needs to act on
 *  and everything already Decided, same shape listAdminPto uses for pending/decided. Decided
 *  is capped to the most recent 200 so this stays one page rather than growing forever, and
 *  (Correction brief #9) anything this admin has already swiped Decided cards to dismiss is
 *  filtered out here — server-side and permanent, same as the dashboard notification banners,
 *  rather than a client-only Set that resets on reload. */
export async function listAdminAvailability(
  actor: CurrentEmployee
): Promise<{ pending: AdminAvailabilityDTO[]; decided: AdminAvailabilityDTO[] }> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const { pending, decided } = await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const [pending, decided] = await Promise.all([
      tx.availabilitySubmission.findMany({
        where: { status: "PENDING" },
        include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { submittedAt: "asc" },
      }),
      tx.availabilitySubmission.findMany({
        // Correction brief #10 (Sept 2026): REMOVED is explicitly "remove it from the normal
        // active/decided interface" — excluded here the same way PENDING already is, so a
        // removed request doesn't reappear in Decided right after an admin clears it out.
        where: { status: { notIn: ["PENDING", "REMOVED"] } },
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

  const decidedKeys = decided.map(decidedDismissalKey);
  const dismissedKeys = await listDismissedKeys(actor, decidedKeys);
  const visibleDecided = decided.filter((_, i) => !dismissedKeys.has(decidedKeys[i]));

  return { pending, decided: visibleDecided };
}

/**
 * Correction brief #9 (Sept 2026): persists an admin swiping "Clear" on one Decided availability
 * card — same admin-only access as the roster it's clearing a row from. Recomputes the key from
 * the submission's OWN current status/reviewedAt, never trusting whatever the client last saw,
 * same discipline dismissDashboardNotification uses for the banner keys: a stale dismiss request
 * for a submission that's since been Undone and re-decided silently no-ops rather than hiding the
 * new decision (it builds a different key than the one actually in front of the admin right now).
 */
export async function dismissDecidedAvailability(actor: CurrentEmployee, submissionId: string): Promise<void> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const row = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.availabilitySubmission.findUnique({ where: { id: submissionId } })
  );
  if (!row || row.status === "PENDING") return;

  await dismissKey(actor, decidedDismissalKey(toDTO(row)));
}

/**
 * Correction brief #10 (Sept 2026): "administrative cleanup/removal of a request, such as an
 * obsolete or duplicate record" — a swipe-revealed action distinct from Deny. The brief draws the
 * line explicitly:
 *   - Deny (decideAvailability) is a real decision ON THE MERITS of the request: it's recorded
 *     as a decision, the employee is notified, and it only ever applies to a Pending submission.
 *   - Remove is housekeeping: no decision is being made about whether the request itself was
 *     good or bad, so there's no Notification row (nothing here calls writeNotification) — but
 *     it's still recorded ("prefer retaining an internal audit record rather than destroying
 *     important scheduling/HR history"), and unlike Deny it can clear out a request in ANY
 *     non-terminal state (Pending, Approved, Denied, or Adjustment Requested), not just Pending —
 *     an obsolete/duplicate record doesn't stop being clutter just because it was already decided.
 *
 * Same reviewer authority as decideAvailability/undecideAvailability — the caller checks
 * assertCanReviewAvailability (admin, or that employee's actual supervisor) before calling this,
 * and it's enforced again here under the reviewer's own RLS identity. The brief says "authorized
 * administrators," which reads here as the same reviewing authority Approve/Deny/Undo already
 * share on this exact card, not a stricter admin-only carve-out for one button among them — worth
 * flagging in case the intent was actually to restrict Remove to Admin/Super Admin only.
 *
 * Never a hard delete: sets status REMOVED (see its own doc comment in prisma/schema.prisma)
 * rather than calling .delete(), so the row — and the full decide/undo/adjust history already on
 * it — survives for Activity History even though every normal list filters it out from here on.
 *
 * If this submission already produced a real Shift (Shift.sourceAvailabilitySubmissionId), that
 * shift is left completely untouched: nothing here writes to the Shift table, and Shift's own
 * onDelete: SetNull only matters for a hard delete, which this never performs — "do not silently
 * delete the resulting schedule as a side effect" is satisfied structurally, not by a runtime
 * check. What IS checked here is whether a live (non-Cancelled) shift exists, purely so the audit
 * trail — and the confirmation the caller shows before this ever runs, see
 * TeamAvailabilityCards.tsx — can say so plainly instead of leaving that relationship unmentioned.
 */
export async function removeAvailabilitySubmission(actor: CurrentEmployee, submissionId: string): Promise<void> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    if (existing.status === "REMOVED") {
      throw new InvalidAvailabilityError("This request has already been removed.");
    }
    if (existing.status === "CANCELLED") {
      throw new InvalidAvailabilityError("This request was already withdrawn by the team member.");
    }

    const linkedShift = await tx.shift.findFirst({
      where: { sourceAvailabilitySubmissionId: submissionId, status: { not: "CANCELLED" } },
      select: { id: true },
    });

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: { status: "REMOVED" },
    });
    await writeAuditLog(tx, {
      actorId: actor.id,
      action: "AVAILABILITY_REMOVED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: existing.status,
      newValue: "REMOVED",
      comment: linkedShift
        ? "A shift already scheduled from this request was left unaffected by the removal."
        : undefined,
    });
  });
}
