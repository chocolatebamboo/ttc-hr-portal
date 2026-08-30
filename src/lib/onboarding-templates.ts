import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { assertDocumentUsableForOnboarding, InvalidOnboardingError, OnboardingNotFoundError } from "@/lib/onboarding";
import type {
  CurrentEmployee,
  OnboardingItemType,
  OnboardingTemplateDTO,
  OnboardingTemplateItemDTO,
  OnboardingTemplateSummaryDTO,
} from "@/types";

// Admin-only end to end (see prisma/rls.sql's onboarding_template_all / onboarding_template_item_all)
// — starting a checklist is already admin-only in src/lib/onboarding.ts, so there's no
// supervisor-facing template concept to support here.

const ITEM_INCLUDE = { document: { select: { title: true } } } as const;

type RawTemplateItem = {
  id: string;
  label: string;
  description: string | null;
  itemType: string;
  sortOrder: number;
  documentId: string | null;
  document: { title: string } | null;
  dueOffsetDays: number | null;
};

function toTemplateItemDTO(item: RawTemplateItem): OnboardingTemplateItemDTO {
  return {
    id: item.id,
    label: item.label,
    description: item.description,
    itemType: item.itemType as OnboardingItemType,
    sortOrder: item.sortOrder,
    documentId: item.documentId,
    documentTitle: item.document?.title ?? null,
    dueOffsetDays: item.dueOffsetDays,
  };
}

/** Every template, for the picker shown when starting a new checklist and for the admin
 *  Templates management screen. */
export async function listOnboardingTemplates(actor: CurrentEmployee): Promise<OnboardingTemplateSummaryDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const templates = await tx.onboardingTemplate.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    });
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      itemCount: t._count.items,
    }));
  });
}

/** One template with its full ordered item list, for the template editor. */
export async function getOnboardingTemplate(
  actor: CurrentEmployee,
  templateId: string
): Promise<OnboardingTemplateDTO> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const template = await tx.onboardingTemplate.findUnique({
      where: { id: templateId },
      include: { items: { include: ITEM_INCLUDE, orderBy: { sortOrder: "asc" } } },
    });
    if (!template) throw new OnboardingNotFoundError("That template doesn't exist.");
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      items: template.items.map(toTemplateItemDTO),
    };
  });
}

export async function createOnboardingTemplate(actor: CurrentEmployee, name: string, description?: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (!name.trim()) throw new InvalidOnboardingError("Give the template a name.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingTemplate.create({ data: { name: name.trim(), description: description?.trim() || null } })
  );
}

/** Deleting a template only removes the reusable definition (cascades to its items) — it never
 *  touches a checklist someone already started from it, since applying a template just copies
 *  its items in at that moment and never references the template again afterward. */
export async function deleteOnboardingTemplate(actor: CurrentEmployee, templateId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const template = await tx.onboardingTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new OnboardingNotFoundError("That template doesn't exist.");
    await tx.onboardingTemplate.delete({ where: { id: templateId } });
  });
}

export interface AddTemplateItemInput {
  label: string;
  description?: string;
  itemType: OnboardingItemType;
  documentId?: string;
  dueOffsetDays?: number;
}

/**
 * Adds one step to a template. For a DOCUMENT-type step this only runs the "is this document
 * usable at all" half of the check (exists, not archived, not CONFIDENTIAL_HR) — there's no
 * specific employee yet at authoring time, so there's nothing to auto-assign; that half runs
 * again, for real, when the template is actually applied (startOnboarding in
 * src/lib/onboarding.ts), since the document's own state may have moved on by then.
 */
export async function addOnboardingTemplateItem(
  actor: CurrentEmployee,
  templateId: string,
  input: AddTemplateItemInput
) {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (!input.label.trim()) throw new InvalidOnboardingError("Step description is required.");
  if (input.itemType === "DOCUMENT" && !input.documentId) {
    throw new InvalidOnboardingError("Choose a document for this step.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const template = await tx.onboardingTemplate.findUnique({
      where: { id: templateId },
      include: { items: true },
    });
    if (!template) throw new OnboardingNotFoundError("That template doesn't exist.");

    if (input.itemType === "DOCUMENT" && input.documentId) {
      await assertDocumentUsableForOnboarding(tx, input.documentId);
    }

    return tx.onboardingTemplateItem.create({
      data: {
        templateId,
        label: input.label.trim(),
        description: input.description?.trim() || null,
        itemType: input.itemType,
        documentId: input.itemType === "DOCUMENT" ? input.documentId : null,
        dueOffsetDays: input.dueOffsetDays ?? null,
        sortOrder: template.items.length,
      },
    });
  });
}

export async function removeOnboardingTemplateItem(actor: CurrentEmployee, templateId: string, itemId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const item = await tx.onboardingTemplateItem.findUnique({ where: { id: itemId } });
    if (!item || item.templateId !== templateId) throw new OnboardingNotFoundError("That step doesn't exist.");
    await tx.onboardingTemplateItem.delete({ where: { id: itemId } });
  });
}
