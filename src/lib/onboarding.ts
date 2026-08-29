import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError, assertCanReviewOnboarding } from "@/lib/authorization";
import { acknowledgeDocument, DocumentNotFoundError } from "@/lib/documents";
import type {
  CurrentEmployee,
  EmployeeOnboardingDTO,
  OnboardingAdminSummaryDTO,
  OnboardingItemDTO,
  OnboardingItemStatus,
  OnboardingItemType,
} from "@/types";

export class OnboardingNotFoundError extends Error {
  constructor(message = "That onboarding checklist doesn't exist.") {
    super(message);
    this.name = "OnboardingNotFoundError";
  }
}

export class InvalidOnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOnboardingError";
  }
}

export class MissingReturnReasonError extends Error {
  constructor() {
    super("Let the employee know why this step is being sent back.");
    this.name = "MissingReturnReasonError";
  }
}

// Seeded when HR starts a new hire's checklist — a reasonable Phase 1 default, not a fixed
// template system. All TASK type deliberately: a default seed can't know which real Document
// row (if any) is this org's handbook, so it never guesses at a DOCUMENT/TRAINING/MEETING
// link — admins add those with a real document attached from the Manage tab after this.
const DEFAULT_CHECKLIST_ITEMS = [
  "Complete Direct Deposit Authorization Form",
  "Read and Acknowledge Employee Handbook",
  "Meet with Your Supervisor",
  "Review the Staff Directory",
  "Complete Required Training",
];

// TASK auto-completes the instant it's checked — there's no one else who needs to sign off on
// "I reviewed the staff directory." The other three represent something HR or a supervisor
// should actually verify happened, so they route through AWAITING_APPROVAL first. This is the
// one place that mapping lives; nothing else in this file (or the API routes) re-derives it.
const REQUIRES_APPROVAL_BY_TYPE: Record<OnboardingItemType, boolean> = {
  TASK: false,
  DOCUMENT: true,
  TRAINING: true,
  MEETING: true,
};

type RawItem = {
  id: string;
  onboardingId: string;
  label: string;
  description: string | null;
  itemType: string;
  status: string;
  dueDate: Date | null;
  sortOrder: number;
  documentId: string | null;
  document: { title: string } | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  completedBy: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  returnReason: string | null;
};

const ITEM_INCLUDE = { document: { select: { title: true } } } as const;

/**
 * Applies the strict-single-chain sequencing rule to a set of sibling items: an item is
 * `locked` the moment ANY earlier item (by sortOrder) isn't COMPLETED yet. This is computed
 * fresh every time rather than stored, so reordering, inserting, or reopening an item can
 * never leave a stale LOCKED flag sitting in the database — there IS no stored flag to go
 * stale. Also returns which single item (if any) is the employee's current "what do I need to
 * do right now" focus: the first item that comes back unlocked and not yet COMPLETED.
 */
function withSequencing<T extends { id: string; sortOrder: number; status: string }>(
  items: T[]
): { items: (T & { locked: boolean })[]; currentItemId: string | null } {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  let blocked = false;
  let currentItemId: string | null = null;
  const withLocks = sorted.map((item) => {
    const locked = blocked;
    if (!locked && item.status !== "COMPLETED" && currentItemId === null) {
      currentItemId = item.id;
    }
    if (item.status !== "COMPLETED") blocked = true;
    return { ...item, locked };
  });
  return { items: withLocks, currentItemId };
}

function toItemDTO(item: RawItem & { locked: boolean }): OnboardingItemDTO {
  const itemType = item.itemType as OnboardingItemType;
  return {
    id: item.id,
    label: item.label,
    description: item.description,
    itemType,
    requiresApproval: REQUIRES_APPROVAL_BY_TYPE[itemType],
    status: item.status as OnboardingItemStatus,
    locked: item.locked,
    dueDate: item.dueDate ? item.dueDate.toISOString() : null,
    submittedAt: item.submittedAt ? item.submittedAt.toISOString() : null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    returnReason: item.returnReason,
    documentId: item.documentId,
    documentTitle: item.document?.title ?? null,
    sortOrder: item.sortOrder,
  };
}

function toOnboardingDTO(onboarding: {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  items: RawItem[];
}): EmployeeOnboardingDTO {
  const { items, currentItemId } = withSequencing(onboarding.items);
  return {
    id: onboarding.id,
    startedAt: onboarding.startedAt.toISOString(),
    completedAt: onboarding.completedAt ? onboarding.completedAt.toISOString() : null,
    currentItemId,
    items: items.map(toItemDTO),
  };
}

/** The caller's own checklist, or null if HR hasn't started one for them yet — a perfectly
 *  normal state for a new hire before their first day, not an error. */
export async function getMyOnboarding(actor: CurrentEmployee): Promise<EmployeeOnboardingDTO | null> {
  const onboarding = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.employeeOnboarding.findUnique({
      where: { employeeId: actor.id },
      include: { items: { include: ITEM_INCLUDE } },
    })
  );
  return onboarding ? toOnboardingDTO(onboarding) : null;
}

/** Admin/supervisor detail view for one employee's checklist — same shape as getMyOnboarding.
 *  assertCanReviewOnboarding covers "admin, or this employee's own supervisor" — the same rule
 *  timesheet review already uses. */
export async function getOnboardingForManager(
  actor: CurrentEmployee,
  employeeId: string
): Promise<EmployeeOnboardingDTO | null> {
  await assertCanReviewOnboarding(actor, employeeId);

  const onboarding = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.employeeOnboarding.findUnique({
      where: { employeeId },
      include: { items: { include: ITEM_INCLUDE } },
    })
  );
  return onboarding ? toOnboardingDTO(onboarding) : null;
}

/** Recomputes EmployeeOnboarding.completedAt from its items' current state — set the moment
 *  every item is COMPLETED, cleared the instant that stops being true (an item added, undone,
 *  returned, etc.). Centralized here so every mutation below stays consistent without each one
 *  re-deriving the same rule. */
async function recomputeOnboardingCompletion(actor: CurrentEmployee, onboardingId: string) {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const siblings = await tx.onboardingItem.findMany({ where: { onboardingId } });
    const allComplete = siblings.length > 0 && siblings.every((s) => s.status === "COMPLETED");
    const onboarding = await tx.employeeOnboarding.findUnique({ where: { id: onboardingId } });
    const alreadyMarked = !!onboarding?.completedAt;
    if (allComplete !== alreadyMarked) {
      await tx.employeeOnboarding.update({
        where: { id: onboardingId },
        data: { completedAt: allComplete ? new Date() : null },
      });
    }
  });
}

/**
 * The one action an employee (or an admin, on their behalf) takes to move a step forward.
 * What it actually does depends on the item's type:
 *  - TASK: a plain checkbox. Completes immediately; checking an already-COMPLETED task
 *    un-does it (the only "undo" this file supports — see the note below).
 *  - DOCUMENT: acknowledges the linked Document (via the real acknowledgeDocument() flow —
 *    not a second, honor-system copy of "did they read it") and submits for approval in the
 *    same action, so the employee never has to separately visit the Documents page first.
 *  - TRAINING / MEETING: submits for approval directly — there's no document step first.
 *
 * A DOCUMENT/TRAINING/MEETING item that's COMPLETED or already AWAITING_APPROVAL can't be
 * re-submitted through this action; only a reviewer's approve/return moves it from there (see
 * decideOnboardingItem below). Only a TASK can be un-done, and only because undoing "I
 * acknowledged this document" or "HR approved this" would misrepresent a decision someone
 * ELSE already made about it, not just the employee's own checkbox.
 */
export async function advanceOnboardingItem(actor: CurrentEmployee, itemId: string) {
  const item = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.findUnique({ where: { id: itemId }, include: { onboarding: true } })
  );
  if (!item) throw new OnboardingNotFoundError("That checklist item doesn't exist.");

  const employeeId = item.onboarding.employeeId;
  if (actor.id !== employeeId && !isAdmin(actor)) throw new ForbiddenError();

  const siblings = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.findMany({ where: { onboardingId: item.onboardingId } })
  );
  const { items: sequenced } = withSequencing(siblings);
  const withLock = sequenced.find((s) => s.id === itemId);
  if (withLock?.locked) {
    throw new InvalidOnboardingError("Complete the previous step first.");
  }

  const itemType = item.itemType as OnboardingItemType;

  if (itemType === "TASK") {
    const nextStatus: OnboardingItemStatus = item.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED";
    await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
      tx.onboardingItem.update({
        where: { id: itemId },
        data:
          nextStatus === "COMPLETED"
            ? { status: "COMPLETED", completedAt: new Date(), completedBy: actor.id }
            : { status: "NOT_STARTED", completedAt: null, completedBy: null },
      })
    );
    await recomputeOnboardingCompletion(actor, item.onboardingId);
    return;
  }

  if (item.status === "COMPLETED") {
    throw new InvalidOnboardingError("This step is already complete.");
  }
  if (item.status === "AWAITING_APPROVAL") {
    throw new InvalidOnboardingError("This step is already waiting on approval.");
  }

  if (itemType === "DOCUMENT") {
    // No admin-on-behalf-of override here, unlike TASK/TRAINING/MEETING above/below:
    // acknowledgeDocument() always records the acknowledgment under `actor`, so an admin
    // "advancing" this for someone else would create a real acknowledgment record that
    // misrepresents the ADMIN as having read the document, not the employee. Only the
    // employee themselves may acknowledge their own document.
    if (actor.id !== employeeId) {
      throw new ForbiddenError("Only the employee themselves can acknowledge this document.");
    }
    if (!item.documentId) {
      throw new InvalidOnboardingError("This step isn't linked to a document yet — ask HR to fix its setup.");
    }
    try {
      await acknowledgeDocument(actor, item.documentId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        throw new InvalidOnboardingError(
          "That document isn't available to you — ask HR to check this step's setup."
        );
      }
      throw err;
    }
  }

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.update({
      where: { id: itemId },
      data: { status: "AWAITING_APPROVAL", submittedAt: new Date(), returnReason: null },
    })
  );
}

/**
 * HR/admin, or the employee's own supervisor, approves or returns a step sitting in
 * AWAITING_APPROVAL. Only meaningful for DOCUMENT/TRAINING/MEETING items — a TASK never
 * reaches this state, so there's nothing here for a reviewer to act on.
 */
export async function decideOnboardingItem(
  actor: CurrentEmployee,
  itemId: string,
  decision: "APPROVE" | "RETURN",
  returnReason?: string
) {
  const item = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.findUnique({ where: { id: itemId }, include: { onboarding: true } })
  );
  if (!item) throw new OnboardingNotFoundError("That checklist item doesn't exist.");

  await assertCanReviewOnboarding(actor, item.onboarding.employeeId);

  if (item.status !== "AWAITING_APPROVAL") {
    throw new InvalidOnboardingError("This step isn't waiting on approval right now.");
  }

  if (decision === "RETURN") {
    if (!returnReason?.trim()) throw new MissingReturnReasonError();
    await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
      tx.onboardingItem.update({
        where: { id: itemId },
        data: { status: "RETURNED", returnReason: returnReason.trim(), submittedAt: null },
      })
    );
    return;
  }

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.update({
      where: { id: itemId },
      data: { status: "COMPLETED", completedAt: new Date(), approvedBy: actor.id, approvedAt: new Date() },
    })
  );
  await recomputeOnboardingCompletion(actor, item.onboardingId);
}

/** Admin/supervisor roster: every active employee they may manage (everyone for an admin,
 *  direct reports only for a supervisor), whether or not their checklist has been started. */
export async function listOnboardingForManager(actor: CurrentEmployee): Promise<OnboardingAdminSummaryDTO[]> {
  if (!isAdmin(actor) && actor.role !== "SUPERVISOR") throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employees = await tx.employee.findMany({
      where: {
        deactivatedAt: null,
        ...(isAdmin(actor) ? {} : { supervisorId: actor.id }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        jobTitle: true,
        onboarding: { include: { items: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    return employees.map((e) => ({
      employeeId: e.id,
      employeeName: `${e.preferredName || e.firstName} ${e.lastName}`,
      jobTitle: e.jobTitle,
      onboardingId: e.onboarding?.id ?? null,
      totalItems: e.onboarding?.items.length ?? 0,
      completedItems: e.onboarding?.items.filter((i: { status: string }) => i.status === "COMPLETED").length ?? 0,
      awaitingApprovalCount:
        e.onboarding?.items.filter((i: { status: string }) => i.status === "AWAITING_APPROVAL").length ?? 0,
      completedAt: e.onboarding?.completedAt ? e.onboarding.completedAt.toISOString() : null,
    }));
  });
}

/** Admin starts a new hire's checklist, seeded with the standard starter items. */
export async function startOnboarding(actor: CurrentEmployee, employeeId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employeeOnboarding.findUnique({ where: { employeeId } });
    if (existing) throw new InvalidOnboardingError("This employee's checklist has already been started.");

    return tx.employeeOnboarding.create({
      data: {
        employeeId,
        items: {
          create: DEFAULT_CHECKLIST_ITEMS.map((label, index) => ({ label, itemType: "TASK", sortOrder: index })),
        },
      },
      include: { items: true },
    });
  });
}

export interface AddOnboardingItemInput {
  label: string;
  description?: string;
  itemType: OnboardingItemType;
  documentId?: string;
  dueDate?: Date;
}

/**
 * Admin adds one item to an already-started checklist. For a DOCUMENT-type item, this also
 * makes sure the target employee will actually be ABLE to see and acknowledge the document —
 * an INDIVIDUAL-visibility document with no assignment to them yet gets one created
 * automatically, rather than silently shipping a step the employee's own Document visibility
 * rules would block them from ever completing. A CONFIDENTIAL_HR document is refused outright:
 * that visibility tier is never shown to a non-admin at all (prisma/rls.sql), so it could never
 * be completed as an onboarding step no matter what assignment exists.
 */
export async function addOnboardingItem(
  actor: CurrentEmployee,
  onboardingId: string,
  input: AddOnboardingItemInput
) {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (!input.label.trim()) throw new InvalidOnboardingError("Item description is required.");
  if (input.itemType === "DOCUMENT" && !input.documentId) {
    throw new InvalidOnboardingError("Choose a document for this step.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const onboarding = await tx.employeeOnboarding.findUnique({
      where: { id: onboardingId },
      include: { items: true },
    });
    if (!onboarding) throw new OnboardingNotFoundError();

    if (input.itemType === "DOCUMENT" && input.documentId) {
      const doc = await tx.document.findUnique({ where: { id: input.documentId } });
      if (!doc || doc.archivedAt) throw new InvalidOnboardingError("Choose a valid document.");
      if (doc.visibility === "CONFIDENTIAL_HR") {
        throw new InvalidOnboardingError(
          "Confidential HR documents can't be used as an onboarding step — the employee would never be able to see it."
        );
      }
      if (doc.visibility === "INDIVIDUAL") {
        const assigned = await tx.documentAssignment.findFirst({
          where: { documentId: input.documentId, employeeId: onboarding.employeeId },
        });
        if (!assigned) {
          await tx.documentAssignment.create({
            data: { documentId: input.documentId, employeeId: onboarding.employeeId },
          });
        }
      }
    }

    const nextSortOrder = onboarding.items.length;
    const created = await tx.onboardingItem.create({
      data: {
        onboardingId,
        label: input.label.trim(),
        description: input.description?.trim() || null,
        itemType: input.itemType,
        documentId: input.itemType === "DOCUMENT" ? input.documentId : null,
        dueDate: input.dueDate ?? null,
        sortOrder: nextSortOrder,
      },
    });

    // A freshly-added item is never complete, so a checklist that just finished is reopened —
    // otherwise "100% complete" would silently include an item nobody has done yet.
    await tx.employeeOnboarding.update({ where: { id: onboardingId }, data: { completedAt: null } });

    return created;
  });
}
