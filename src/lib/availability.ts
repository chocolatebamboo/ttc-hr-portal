import type { PrismaClient } from "@prisma/client";
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
  reviewedById: string | null;
  adjustedSlots: unknown;
  dateDecisions: unknown;
};

type NameFields = { firstName: string; lastName: string; preferredName: string | null };

function nameOf(p: NameFields): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

/**
 * CB, Sept 2026: "we need to also know who approved the request." Batch-resolves every
 * reviewedById (whole-submission) and decidedById (per-date) referenced across `rows` to a
 * display name in one query — same "one query beats N" batching shape resolveRefLabels uses in
 * src/lib/direct-messages.ts, rather than a name lookup per row. A submission still sitting fully
 * Pending contributes nothing to the id set, so the common case (a fresh Pending queue) costs no
 * extra query at all.
 */
async function resolveReviewerNames(tx: PrismaClient, rows: AvailabilityRow[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.reviewedById) ids.add(row.reviewedById);
    const slots = row.slots as unknown as AvailabilitySlot[];
    for (const d of readDateDecisions(slots, row.dateDecisions)) {
      if (d.decidedById) ids.add(d.decidedById);
    }
  }
  if (ids.size === 0) return new Map();
  const employees = await tx.employee.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, firstName: true, lastName: true, preferredName: true },
  });
  return new Map(employees.map((e) => [e.id, nameOf(e)] as const));
}

/** Every entry in `slots`, defaulted to PENDING — what a brand-new submission's dateDecisions
 *  starts as (submitAvailability), and the fallback for any row created before this column
 *  existed (dateDecisions is null in the database). Keeping this derivation in one place means
 *  an old row behaves exactly like a fresh one: nothing decided per-date yet, bulk actions still
 *  fully available. */
function defaultDateDecisions(slots: AvailabilitySlot[]): AvailabilityDateDecision[] {
  return slots.map((s) => ({
    date: s.date,
    status: "PENDING" as const,
    decidedAt: null,
    decidedById: null,
    decidedByName: null,
    comment: null,
  }));
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

/** `names` is a pre-resolved employeeId->display-name map (see resolveReviewerNames above) —
 *  defaults to empty so every existing single-row call site keeps compiling unchanged; those
 *  either have nothing to resolve (reviewedById/decidedById just got cleared to null) or pass a
 *  small one-off map built straight from the reviewer/actor already in scope, no query needed. */
function toDTO(row: AvailabilityRow, names: Map<string, string> = new Map()): AvailabilityDTO {
  const slots = row.slots as unknown as AvailabilitySlot[];
  const dateDecisions = readDateDecisions(slots, row.dateDecisions).map((d) => ({
    ...d,
    decidedByName: d.decidedById ? (names.get(d.decidedById) ?? null) : null,
  }));
  return {
    id: row.id,
    slots,
    note: row.note,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewedByName: row.reviewedById ? (names.get(row.reviewedById) ?? null) : null,
    adjustedSlots: row.adjustedSlots ? (row.adjustedSlots as unknown as AvailabilitySlot[]) : null,
    dateDecisions,
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

    const names = await resolveReviewerNames(tx, rows);
    return rows.map((row) => {
      const dto = toDTO(row, names);
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
    const names = await resolveReviewerNames(tx, rows);
    return rows.map((row) => toDTO(row, names));
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
 * Employee permanently removes one of their own CANCELLED or APPROVED submissions — CB, Sept
 * 2026: "the deleting isn't working on these," pointing at old Cancelled entries piling up in
 * the submissions preview next to the calendar. Same Cancelled-only rule as deletePtoRequest
 * (src/lib/pto-actions.ts) originally, on the reasoning that a Pending, Denied, or Approved
 * record still means something — still awaiting a decision, or a real decision that was made.
 *
 * CB, Sept 2026 (redesign follow-up), pointing at an Approved submission on her own "Your
 * submissions" list: "I need to be able to delete it and knock it off the schedule." Confirmed
 * scope: Approved joins Cancelled as directly deletable by the employee themselves — no Cancel
 * step first (there isn't one for Approved; cancelAvailabilitySubmission is still Pending/Denied-
 * only, unchanged). Pending and Denied stay NOT directly deletable — those still go through
 * Cancel first, same as before, so there's still a record of something that was actually
 * withdrawn rather than just made to disappear.
 *
 * If a Shift was already created from this submission (convertAvailabilityDateToShift), that
 * Shift is untouched — Shift.sourceAvailabilitySubmissionId is ON DELETE SET NULL, so the
 * already-scheduled shift just loses its pointer back to the submission that produced it, same
 * as any other source-record cleanup in this app. Nothing about the actual schedule changes.
 */
export async function deleteAvailabilitySubmission(actor: CurrentEmployee, submissionId: string): Promise<void> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.employeeId !== actor.id) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    if (existing.status !== "CANCELLED" && existing.status !== "APPROVED") {
      throw new InvalidAvailabilityError(
        'Only a "Cancelled" or "Approved" submission can be deleted — clear a Pending or Denied one first.'
      );
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
    return toDTO(row, new Map([[reviewer.id, nameOf(reviewer)]]));
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
    return toDTO(row, new Map([[reviewer.id, nameOf(reviewer)]]));
  });
}

/**
 * Adds or replaces the reviewer's note on an already-decided submission, without touching the
 * decision itself — CB, Sept 2026: "I shouldn't have to explain myself... if I want to make a
 * comment, that should be an optional thing." Deny (decideAvailability above) now fires
 * immediately with no comment step; this is that comment, added afterward instead of gating the
 * click. Only valid once the submission has actually been decided — a still-Pending submission
 * has no decision yet for a note to attach to.
 */
export async function addAvailabilityReviewComment(
  reviewer: CurrentEmployee,
  submissionId: string,
  comment: string
): Promise<AvailabilityDTO> {
  const trimmed = comment.trim();
  if (!trimmed) {
    throw new InvalidAvailabilityError("A note is required.");
  }
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.status === "PENDING") {
      throw new InvalidAvailabilityError("Only a decided request can have a note added.");
    }
    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: { reviewComment: trimmed },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: "AVAILABILITY_COMMENT_ADDED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      newValue: trimmed,
      comment: trimmed,
    });
    return toDTO(row, new Map([[reviewer.id, nameOf(reviewer)]]));
  });
}

/**
 * Per-date counterpart to addAvailabilityReviewComment above — attaches a note to ONE date's
 * already-made decision inside dateDecisions, without reopening or changing it. Same either/or
 * scoping as decideAvailabilityDate: valid once that specific date (not necessarily the whole
 * submission) has moved off PENDING, since a per-date decision can land while the rest of a
 * multi-date submission is still waiting.
 */
export async function addAvailabilityDateReviewComment(
  reviewer: CurrentEmployee,
  submissionId: string,
  date: string,
  comment: string
): Promise<AvailabilityDTO> {
  const trimmed = comment.trim();
  if (!trimmed) {
    throw new InvalidAvailabilityError("A note is required.");
  }
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    const slots = existing.slots as unknown as AvailabilitySlot[];
    const decisions = readDateDecisions(slots, existing.dateDecisions);
    const index = decisions.findIndex((d) => d.date === date);
    if (index === -1) {
      throw new InvalidAvailabilityError("That date isn't part of this submission.");
    }
    if (decisions[index].status === "PENDING") {
      throw new InvalidAvailabilityError("Only a decided date can have a note added.");
    }

    const nextDecisions = decisions.slice();
    nextDecisions[index] = { ...nextDecisions[index], comment: trimmed };

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: { dateDecisions: nextDecisions as unknown as Prisma.InputJsonValue },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: "AVAILABILITY_DATE_COMMENT_ADDED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: date,
      newValue: trimmed,
      comment: trimmed,
    });
    return toDTO(row, new Map([[reviewer.id, nameOf(reviewer)]]));
  });
}

/**
 * CB, Sept 2026, on the original two-step "propose new date/time, wait for the team member to
 * confirm" flow: "we shouldn't have to wait on the team member... once we set it, then that
 * becomes the new schedule, and then it just updates on the team member's end." Replaces
 * requestAvailabilityAdjustment/respondToAvailabilityAdjustment below for new use — this sets
 * ONE date's new date and/or time and approves it immediately, in the same single call, the same
 * per-date granularity decideAvailabilityDate already uses (and with the exact same "only a
 * still-Pending date can be acted on" guard). No ADJUSTMENT_REQUESTED status is ever entered by
 * this path — the reviewer's choice is final the moment they make it, same authority Approve/
 * Deny already carry; a team member with something to say about it does so through the DM/task
 * comment thread, not a formal accept/decline. (requestAvailabilityAdjustment and
 * respondToAvailabilityAdjustment are left in place, unused by the current UI, rather than
 * removed outright — no live submission is sitting in ADJUSTMENT_REQUESTED as of this change, so
 * nothing depends on them, but ripping out a whole status/flow isn't this change's job.)
 *
 * `newSlot.date` may differ from `date` (the admin can move the date itself, not just the time —
 * QA pass's earlier "there's no way to change the date" note already established this for the
 * old flow, carried over here). Guarded against colliding with another date already on this same
 * submission, which `slots`/`dateDecisions` both assume never happens (each keyed uniquely by
 * date).
 */
export async function changeAvailabilityDate(
  reviewer: CurrentEmployee,
  submissionId: string,
  date: string,
  newSlot: AvailabilitySlot,
  comment?: string
): Promise<AvailabilityDTO> {
  assertValidSlots([newSlot]);

  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing || existing.status !== "PENDING") {
      throw new InvalidAvailabilityError('Only a "Pending" submission can be changed.');
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
    if (newSlot.date !== date && slots.some((s, i) => i !== index && s.date === newSlot.date)) {
      throw new InvalidAvailabilityError("This request already has a date entry for that day.");
    }

    const trimmedComment = comment?.trim() || null;
    const nextSlots = slots.slice();
    nextSlots[index] = newSlot;
    const nextDecisions = decisions.slice();
    nextDecisions[index] = {
      date: newSlot.date,
      status: "APPROVED",
      decidedAt: new Date().toISOString(),
      decidedById: reviewer.id,
      decidedByName: null,
      comment: trimmedComment,
    };
    const nowFullyDecided = allDatesDecided(nextDecisions);

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: {
        slots: nextSlots as unknown as Prisma.InputJsonValue,
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
      action: "AVAILABILITY_DATE_CHANGED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: date,
      newValue: newSlot.date,
      comment: trimmedComment ?? undefined,
    });
    await writeNotification(tx, {
      recipientId: existing.employeeId,
      type: "AVAILABILITY_APPROVED",
      title:
        newSlot.date !== date
          ? `Your ${date} request was approved for ${newSlot.date} instead`
          : `Your ${date} availability was approved for a different time`,
      body: trimmedComment ?? undefined,
      targetType: "AvailabilitySubmission",
      targetId: row.id,
    });
    return toDTO(row, new Map([[reviewer.id, nameOf(reviewer)]]));
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
 * CB, Sept 2026: "even if it's approved, I should still be able to make adjustments just in
 * case as an admin... it's not just final." The per-date counterpart to undecideAvailability
 * above — that one only ever appears once the WHOLE submission has reached a terminal status
 * (its own "Undo" button is gated on `!isPending`), so it never helps the in-between case: a
 * multi-date request where this one date was already approved/denied individually but the
 * submission as a whole is still sitting in the Pending queue because other dates aren't decided
 * yet. This reopens just THAT ONE date back to PENDING — decidedAt/decidedById/comment all
 * cleared, same "as if it had never been decided" shape undecideAvailability gives the whole
 * submission — while every other date's own decision is left completely untouched.
 *
 * Refused once a real Shift already exists for this date (Shift.sourceAvailabilitySubmissionId +
 * date, same lookup convertAvailabilityDateToShift's own duplicate-guard uses in
 * src/lib/shifts.ts) — the two-step workflow means that date's shift is already confirmed and
 * potentially in progress; reopening the availability decision underneath it would leave a
 * confirmed shift pointing at a date with no real decision behind it. A shift already on the
 * books gets changed through Team Schedule's own reassign/change/cancel flow instead, not by
 * unwinding the availability approval that originally produced it.
 */
export async function undecideAvailabilityDate(
  reviewer: CurrentEmployee,
  submissionId: string,
  date: string
): Promise<AvailabilityDTO> {
  return withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, async (tx) => {
    const existing = await tx.availabilitySubmission.findUnique({ where: { id: submissionId } });
    if (!existing) {
      throw new InvalidAvailabilityError("Submission not found.");
    }
    const slots = existing.slots as unknown as AvailabilitySlot[];
    const decisions = readDateDecisions(slots, existing.dateDecisions);
    const index = decisions.findIndex((d) => d.date === date);
    if (index === -1) {
      throw new InvalidAvailabilityError("That date isn't part of this submission.");
    }
    if (decisions[index].status === "PENDING") {
      throw new InvalidAvailabilityError("This date hasn't been decided yet.");
    }

    const linkedShift = await tx.shift.findFirst({
      where: { sourceAvailabilitySubmissionId: submissionId, date, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (linkedShift) {
      throw new InvalidAvailabilityError(
        "This date already has a confirmed shift — change or cancel it from Team Schedule instead."
      );
    }

    const nextDecisions = decisions.slice();
    nextDecisions[index] = {
      date,
      status: "PENDING",
      decidedAt: null,
      decidedById: null,
      decidedByName: null,
      comment: null,
    };

    const row = await tx.availabilitySubmission.update({
      where: { id: submissionId },
      data: {
        dateDecisions: nextDecisions as unknown as Prisma.InputJsonValue,
        // If the submission had already reached a whole-submission terminal status (every date
        // was decided, so this one date being reopened means it's no longer "fully decided"),
        // reopen the submission itself back to Pending too — same reasoning undecideAvailability
        // already applies at the whole-submission level, just reached from one date's own Undo
        // instead of the card-level one. A submission that was still Pending (other dates not
        // decided yet) simply stays Pending, unaffected.
        ...(existing.status !== "PENDING"
          ? { status: "PENDING", reviewedById: null, reviewedAt: null, reviewComment: null }
          : {}),
      },
    });
    await writeAuditLog(tx, {
      actorId: reviewer.id,
      action: "AVAILABILITY_DATE_UNDECIDED",
      targetType: "AvailabilitySubmission",
      targetId: row.id,
      oldValue: date,
      newValue: "PENDING",
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
    return toDTO(row, new Map([[reviewer.id, nameOf(reviewer)]]));
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
      action: accept ?
