import { withRlsContext } from "@/lib/db";
import type { CurrentEmployee } from "@/types";

/**
 * Correction brief (Sept 2026, "Correction & Refinement Brief" #1/#9): "the user must also be
 * able to dismiss/clear applicable notifications... a deliberately dismissed notification must
 * remain dismissed. Do not display a 'Show Again.'" Backs the two DashboardNotifications
 * banners (src/lib/dashboard-notifications.ts) — replaces the old client-only localStorage
 * dismissal (per-browser, recoverable via its own "N cleared — show again" link) with a real
 * per-employee record.
 *
 * A dismissal `key` is content-derived — e.g. "messages:3", "approvals:2", built in
 * src/lib/dashboard-notifications.ts from the CURRENT count at the moment of dismissal, never
 * client-supplied — same scheme the original localStorage implementation used for exactly the
 * same reason: a *different* count is genuinely new information, so dismissing "3 messages"
 * never silently swallows a later "5 messages," without needing to compare timestamps at all.
 * Old keys for counts that no longer apply just sit unused — fine at this company's size, same
 * "full scan every time" tradeoff listTeamNoteTopicCounts/listConversationSummaries already make.
 */
export async function isDismissed(actor: CurrentEmployee, key: string): Promise<boolean> {
  const row = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.dashboardDismissal.findUnique({
      where: { employeeId_key: { employeeId: actor.id, key } },
      select: { id: true },
    })
  );
  return row !== null;
}

export async function dismiss(actor: CurrentEmployee, key: string): Promise<void> {
  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.dashboardDismissal.upsert({
      where: { employeeId_key: { employeeId: actor.id, key } },
      create: { employeeId: actor.id, key },
      update: { dismissedAt: new Date() },
    })
  );
}
