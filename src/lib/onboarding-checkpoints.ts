import { withRlsContext } from "@/lib/db";
import { assertCanReviewOnboarding } from "@/lib/authorization";
import { OnboardingNotFoundError } from "@/lib/onboarding";
import type { CurrentEmployee, OnboardingCheckpointDTO } from "@/types";

// Lightweight 30/60/90-day onboarding follow-ups — see OnboardingCheckpoint's doc comment in
// prisma/schema.prisma. Admin/supervisor-only, like onboarding-readiness.ts (see prisma/rls.sql
// for why this table has no self-access clause either). Reuses assertCanReviewOnboarding for
// the same reason that file does: "who may see this employee's onboarding-adjacent state" is
// one rule, not a new one per table.

function toDTO(item: {
  id: string;
  milestone: string;
  dueDate: Date;
  status: string;
  notes: string | null;
  followUpNeeded: boolean;
  trainingMilestones: string | null;
  developmentGoals: string | null;
  completedAt: Date | null;
}): OnboardingCheckpointDTO {
  return {
    id: item.id,
    milestone: item.milestone,
    dueDate: item.dueDate.toISOString(),
    status: item.status as OnboardingCheckpointDTO["status"],
    notes: item.notes,
    followUpNeeded: item.followUpNeeded,
    trainingMilestones: item.trainingMilestones,
    developmentGoals: item.developmentGoals,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
  };
}

/** Every checkpoint for one employee, in due-date order. Empty (not an error) until HR starts
 *  that employee's onboarding checklist for the first time — see startOnboarding in
 *  src/lib/onboarding.ts, which seeds the three fixed milestones alongside it. */
export async function listCheckpoints(
  actor: CurrentEmployee,
  employeeId: string
): Promise<OnboardingCheckpointDTO[]> {
  await assertCanReviewOnboarding(actor, employeeId);

  const items = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingCheckpoint.findMany({
      where: { employeeId },
      orderBy: { dueDate: "asc" },
    })
  );
  return items.map(toDTO);
}

export interface UpdateCheckpointInput {
  notes?: string;
  followUpNeeded?: boolean;
  trainingMilestones?: string;
  developmentGoals?: string;
}

/** Updates a checkpoint's freeform fields — a plain edit, not a workflow transition (that's
 *  toggleCheckpointComplete below). Only the fields present in `input` are touched, so the UI
 *  can save one field at a time without clobbering the others. */
export async function updateCheckpoint(actor: CurrentEmployee, checkpointId: string, input: UpdateCheckpointInput) {
  const checkpoint = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingCheckpoint.findUnique({ where: { id: checkpointId } })
  );
  if (!checkpoint) throw new OnboardingNotFoundError("That checkpoint doesn't exist.");

  await assertCanReviewOnboarding(actor, checkpoint.employeeId);

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingCheckpoint.update({
      where: { id: checkpointId },
      data: {
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
        ...(input.followUpNeeded !== undefined ? { followUpNeeded: input.followUpNeeded } : {}),
        ...(input.trainingMilestones !== undefined
          ? { trainingMilestones: input.trainingMilestones.trim() || null }
          : {}),
        ...(input.developmentGoals !== undefined ? { developmentGoals: input.developmentGoals.trim() || null } : {}),
      },
    })
  );
}

/** Flips one checkpoint between PENDING/COMPLETED — a plain admin/supervisor checkbox, no
 *  approval step (the same "nobody else needs to sign off" reasoning as readiness items). */
export async function toggleCheckpointComplete(actor: CurrentEmployee, checkpointId: string) {
  const checkpoint = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingCheckpoint.findUnique({ where: { id: checkpointId } })
  );
  if (!checkpoint) throw new OnboardingNotFoundError("That checkpoint doesn't exist.");

  await assertCanReviewOnboarding(actor, checkpoint.employeeId);

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingCheckpoint.update({
      where: { id: checkpointId },
      data:
        checkpoint.status === "PENDING"
          ? { status: "COMPLETED", completedAt: new Date(), completedBy: actor.id }
          : { status: "PENDING", completedAt: null, completedBy: null },
    })
  );
}
