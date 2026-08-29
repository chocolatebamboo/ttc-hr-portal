import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import type {
  CurrentEmployee,
  EmployeeOnboardingDTO,
  OnboardingAdminSummaryDTO,
  OnboardingItemStatus,
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

// Seeded when HR starts a new hire's checklist — a reasonable Phase 1 default, not a fixed
// template system. Admins add/adjust items per employee after this from the Manage tab.
const DEFAULT_CHECKLIST_ITEMS = [
  "Complete Direct Deposit Authorization Form",
  "Read and Acknowledge Employee Handbook",
  "Meet with Your Supervisor",
  "Review the Staff Directory",
  "Complete Required Training",
];

function toItemDTO(item: {
  id: string;
  label: string;
  status: string;
  dueDate: Date | null;
  completedAt: Date | null;
  sortOrder: number;
}) {
  return {
    id: item.id,
    label: item.label,
    status: item.status as OnboardingItemStatus,
    dueDate: item.dueDate ? item.dueDate.toISOString() : null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    sortOrder: item.sortOrder,
  };
}

function toOnboardingDTO(onboarding: {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  items: Parameters<typeof toItemDTO>[0][];
}): EmployeeOnboardingDTO {
  return {
    id: onboarding.id,
    startedAt: onboarding.startedAt.toISOString(),
    completedAt: onboarding.completedAt ? onboarding.completedAt.toISOString() : null,
    items: [...onboarding.items].sort((a, b) => a.sortOrder - b.sortOrder).map(toItemDTO),
  };
}

/** The caller's own checklist, or null if HR hasn't started one for them yet — a perfectly
 *  normal state for a new hire before their first day, not an error. */
export async function getMyOnboarding(actor: CurrentEmployee): Promise<EmployeeOnboardingDTO | null> {
  const onboarding = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.employeeOnboarding.findUnique({
      where: { employeeId: actor.id },
      include: { items: true },
    })
  );
  return onboarding ? toOnboardingDTO(onboarding) : null;
}

/**
 * Flips one item between NOT_STARTED and COMPLETED. Works for both an employee checking off
 * their own item and an admin marking it on someone's behalf — RLS's onboarding_item_update
 * policy (is_admin() OR "this item belongs to my own onboarding") is what actually decides
 * who may touch which row; this function doesn't re-derive that relationship itself. Also
 * keeps EmployeeOnboarding.completedAt in sync: set the moment every item is COMPLETED,
 * cleared the moment any item is toggled back.
 */
export async function toggleOnboardingItem(actor: CurrentEmployee, itemId: string) {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const item = await tx.onboardingItem.findUnique({ where: { id: itemId } });
    if (!item) throw new OnboardingNotFoundError("That checklist item doesn't exist.");

    const nextStatus: OnboardingItemStatus = item.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED";
    const updated = await tx.onboardingItem.update({
      where: { id: itemId },
      data:
        nextStatus === "COMPLETED"
          ? { status: "COMPLETED", completedAt: new Date(), completedBy: actor.id }
          : { status: "NOT_STARTED", completedAt: null, completedBy: null },
    });

    const siblings = await tx.onboardingItem.findMany({ where: { onboardingId: item.onboardingId } });
    const allComplete = siblings.length > 0 && siblings.every((s) => s.status === "COMPLETED");
    await tx.employeeOnboarding.update({
      where: { id: item.onboardingId },
      data: { completedAt: allComplete ? new Date() : null },
    });

    return updated;
  });
}

/** Admin roster: every active employee, whether or not their checklist has been started. */
export async function listOnboardingForAdmin(actor: CurrentEmployee): Promise<OnboardingAdminSummaryDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employees = await tx.employee.findMany({
      where: { deactivatedAt: null },
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
      completedAt: e.onboarding?.completedAt ? e.onboarding.completedAt.toISOString() : null,
    }));
  });
}

/** Admin's detail view for one employee's checklist — same shape as getMyOnboarding, just
 *  reachable for any active employee rather than only the caller themselves. */
export async function getOnboardingForAdmin(
  actor: CurrentEmployee,
  employeeId: string
): Promise<EmployeeOnboardingDTO | null> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const onboarding = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.employeeOnboarding.findUnique({
      where: { employeeId },
      include: { items: true },
    })
  );
  return onboarding ? toOnboardingDTO(onboarding) : null;
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
          create: DEFAULT_CHECKLIST_ITEMS.map((label, index) => ({ label, sortOrder: index })),
        },
      },
      include: { items: true },
    });
  });
}

/** Admin adds one custom item to an already-started checklist. */
export async function addOnboardingItem(
  actor: CurrentEmployee,
  onboardingId: string,
  input: { label: string; dueDate?: Date }
) {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (!input.label.trim()) throw new InvalidOnboardingError("Item description is required.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const onboarding = await tx.employeeOnboarding.findUnique({
      where: { id: onboardingId },
      include: { items: true },
    });
    if (!onboarding) throw new OnboardingNotFoundError();

    const nextSortOrder = onboarding.items.length;
    const created = await tx.onboardingItem.create({
      data: {
        onboardingId,
        label: input.label.trim(),
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
