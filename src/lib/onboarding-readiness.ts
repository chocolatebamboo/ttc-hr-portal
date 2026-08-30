import { withRlsContext } from "@/lib/db";
import { assertCanReviewOnboarding } from "@/lib/authorization";
import { OnboardingNotFoundError } from "@/lib/onboarding";
import type { CurrentEmployee, OnboardingReadinessItemDTO } from "@/types";

// Admin/supervisor-only internal readiness tasks (background check, TTC email created,
// equipment issued, workspace prepared, etc.) — see OnboardingReadinessItem's doc comment in
// prisma/schema.prisma for why this is a separate table from OnboardingItem, and
// prisma/rls.sql for why it deliberately has no self-access clause: unlike every other
// onboarding table, an employee should never see or be able to fetch their own row here.
//
// Reuses assertCanReviewOnboarding (admin, or the target employee's own supervisor) — the same
// rule that already gates reviewing an employee's real onboarding checklist, since "who may see
// this employee's onboarding-adjacent state" is one rule, not two.

function toDTO(item: {
  id: string;
  label: string;
  completedAt: Date | null;
  sortOrder: number;
}): OnboardingReadinessItemDTO {
  return {
    id: item.id,
    label: item.label,
    completed: item.completedAt !== null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    sortOrder: item.sortOrder,
  };
}

/** Every readiness item for one employee, in display order. Empty (not an error) until HR
 *  starts that employee's onboarding checklist for the first time — see startOnboarding in
 *  src/lib/onboarding.ts, which seeds these alongside it. */
export async function listReadinessItems(
  actor: CurrentEmployee,
  employeeId: string
): Promise<OnboardingReadinessItemDTO[]> {
  await assertCanReviewOnboarding(actor, employeeId);

  const items = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingReadinessItem.findMany({
      where: { employeeId },
      orderBy: { sortOrder: "asc" },
    })
  );
  return items.map(toDTO);
}

/** Flips one readiness item between done/not-done — a plain admin/supervisor checkbox, no
 *  approval step (unlike OnboardingItem, nobody but the person checking it needs to sign off on
 *  "the background check is done"). */
export async function toggleReadinessItem(actor: CurrentEmployee, itemId: string) {
  const item = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingReadinessItem.findUnique({ where: { id: itemId } })
  );
  if (!item) throw new OnboardingNotFoundError("That readiness task doesn't exist.");

  await assertCanReviewOnboarding(actor, item.employeeId);

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingReadinessItem.update({
      where: { id: itemId },
      data:
        item.completedAt === null
          ? { completedAt: new Date(), completedBy: actor.id }
          : { completedAt: null, completedBy: null },
    })
  );
}
