import type { PrismaClient } from "@prisma/client";
import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError, assertCanReviewOnboarding } from "@/lib/authorization";
import { acknowledgeDocument, DocumentNotFoundError } from "@/lib/documents";
import type {
  CurrentEmployee,
  EmployeeOnboardingDTO,
  OnboardingAdminSummaryDTO,
  OnboardingAttentionDTO,
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

/**
 * Shared by addOnboardingItem below and by applying a template (src/lib/onboarding-templates.ts)
 * — both create a real DOCUMENT-type OnboardingItem, so both need the same "is this document
 * actually usable as a step" check: it must exist, not be archived, and not be CONFIDENTIAL_HR
 * (that visibility tier is never shown to a non-admin at all — prisma/rls.sql — so it could
 * never be completed as a step no matter what assignment exists). Template AUTHORING
 * (addOnboardingTemplateItem) also uses just this half of the check — there's no specific
 * employee yet at that point, so there's nothing to auto-assign.
 */
export async function assertDocumentUsableForOnboarding(tx: PrismaClient, documentId: string) {
  const doc = await tx.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.archivedAt) throw new InvalidOnboardingError("Choose a valid document.");
  if (doc.visibility === "CONFIDENTIAL_HR") {
    throw new InvalidOnboardingError(
      "Confidential HR documents can't be used as an onboarding step — the employee would never be able to see it."
    );
  }
  return doc;
}

/**
 * The other half of the DOCUMENT-item safety check, once a real target employee is known: an
 * INDIVIDUAL-visibility document with no assignment to them yet gets one created automatically,
 * rather than silently shipping a step the employee's own Document visibility rules would block
 * them from ever completing.
 */
async function ensureDocumentAssigned(
  tx: PrismaClient,
  employeeId: string,
  documentId: string,
  visibility: string
) {
  if (visibility !== "INDIVIDUAL") return;
  const assigned = await tx.documentAssignment.findFirst({ where: { documentId, employeeId } });
  if (!assigned) {
    await tx.documentAssignment.create({ data: { documentId, employeeId } });
  }
}

/**
 * Admin starts a new hire's checklist — either seeded with the standard starter items (no
 * `templateId`), or copied from a named OnboardingTemplate (src/lib/onboarding-templates.ts).
 * Applying a template just copies its items in at this moment; the template itself is never
 * referenced again afterward, so editing or deleting it later never touches a checklist someone
 * already started from it. Every DOCUMENT-type template item is re-validated here (not just
 * trusted from when the template was built) since the document's own state — archived,
 * visibility changed — may have moved on since.
 */
export async function startOnboarding(actor: CurrentEmployee, employeeId: string, templateId?: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employeeOnboarding.findUnique({ where: { employeeId } });
    if (existing) throw new InvalidOnboardingError("This employee's checklist has already been started.");

    if (!templateId) {
      return tx.employeeOnboarding.create({
        data: {
          employeeId,
          items: {
            create: DEFAULT_CHECKLIST_ITEMS.map((label, index) => ({ label, itemType: "TASK", sortOrder: index })),
          },
        },
        include: { items: true },
      });
    }

    const template = await tx.onboardingTemplate.findUnique({
      where: { id: templateId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!template) throw new InvalidOnboardingError("That template no longer exists.");
    if (template.items.length === 0) {
      throw new InvalidOnboardingError("That template has no steps yet — add some before using it.");
    }

    const startedAt = new Date();

    // Validate every distinct document up front, before creating anything, so one bad template
    // item fails the whole start rather than leaving a half-built checklist behind.
    const visibilityByDocumentId = new Map<string, string>();
    for (const item of template.items) {
      if (item.itemType === "DOCUMENT" && item.documentId && !visibilityByDocumentId.has(item.documentId)) {
        const doc = await assertDocumentUsableForOnboarding(tx, item.documentId);
        visibilityByDocumentId.set(item.documentId, doc.visibility);
      }
    }
    for (const [documentId, visibility] of visibilityByDocumentId) {
      await ensureDocumentAssigned(tx, employeeId, documentId, visibility);
    }

    return tx.employeeOnboarding.create({
      data: {
        employeeId,
        startedAt,
        items: {
          create: template.items.map((item, index) => ({
            label: item.label,
            description: item.description,
            itemType: item.itemType,
            documentId: item.itemType === "DOCUMENT" ? item.documentId : null,
            dueDate:
              item.dueOffsetDays != null
                ? new Date(startedAt.getTime() + item.dueOffsetDays * 24 * 60 * 60 * 1000)
                : null,
            sortOrder: index,
          })),
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
 * Admin adds one item to an already-started checklist. See assertDocumentUsableForOnboarding
 * above for the DOCUMENT-type safety checks this reuses.
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
      const doc = await assertDocumentUsableForOnboarding(tx, input.documentId);
      await ensureDocumentAssigned(tx, onboarding.employeeId, input.documentId, doc.visibility);
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

/**
 * Live "does anything need this person's attention right now" summary — powers the small nav
 * badge (RoleNav/BottomNav) and the Dashboard's "Needs your attention" list. Deliberately NOT a
 * persisted notification/read-tracking system (no new table, nothing to mark read): it's always
 * exactly the truth of the current state, recomputed on every page load, the same way the
 * Documents page's "pending acknowledgment" list already works. An employee's own actionable or
 * returned step takes priority; admins/supervisors additionally see whether anyone they manage
 * has something awaiting their approval.
 */
export async function getOnboardingAttention(actor: CurrentEmployee): Promise<OnboardingAttentionDTO> {
  const mine = await getMyOnboarding(actor);
  if (mine && !mine.completedAt) {
    const current = mine.items.find((i) => i.id === mine.currentItemId);
    if (current && (current.status === "NOT_STARTED" || current.status === "RETURNED")) {
      return {
        needsAttention: true,
        label: current.status === "RETURNED" ? `Returned: ${current.label}` : current.label,
      };
    }
  }

  if (isAdmin(actor) || actor.role === "SUPERVISOR") {
    const roster = await listOnboardingForManager(actor);
    const pending = roster.reduce((sum, r) => sum + r.awaitingApprovalCount, 0);
    if (pending > 0) {
      return {
        needsAttention: true,
        label: `${pending} onboarding step${pending === 1 ? "" : "s"} awaiting your approval`,
      };
    }
  }

  return { needsAttention: false, label: null };
}
