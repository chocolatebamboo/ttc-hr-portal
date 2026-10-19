import { isAdmin, canAccessReports } from "@/lib/authorization";
import { listAdminAvailability } from "@/lib/availability";
import { listTeamNoteTopicCounts, listAllTeamNoteTopicCounts } from "@/lib/team-notes";
import { listConversationSummaries } from "@/lib/direct-messages";
import { isDismissed, dismiss } from "@/lib/dashboard-dismissals";
import { getClosedPayrollPeriod } from "@/lib/week";
import { getPayrollHoursReport } from "@/lib/payroll";
import type { CurrentEmployee } from "@/types";

export interface DashboardNotificationsSummary {
  approvals: { count: number; show: boolean };
  messages: { unread: number; show: boolean };
  reportReady: { show: boolean; periodStart: string; periodEnd: string; teamCount: number };
}

function approvalsKey(count: number): string {
  return `approvals:${count}`;
}

function messagesKey(count: number): string {
  return `messages:${count}`;
}

function reportReadyKey(periodEnd: string): string {
  return `reportReady:${periodEnd}`;
}

/**
 * Correction brief (Sept 2026, "Correction & Refinement Brief" #1): one place that computes
 * both DashboardNotifications banners' real counts AND whether each is still dismissed for the
 * current count — shared by the dashboard page's initial server render (so there's no flash of
 * a banner that's about to be replaced) and GET /api/dashboard/notifications (which the client
 * polls afterwards for live updates, same NotificationBell.tsx polling shape). Doing the count
 * math in exactly one place also means the dismiss route below can recompute the current key
 * itself rather than trusting a client-supplied count.
 */
export async function getDashboardNotificationsSummary(
  actor: CurrentEmployee
): Promise<DashboardNotificationsSummary> {
  const admin = isAdmin(actor);
  // Round twelve (CB, Oct 2026): the report-ready celebration card is for "me, Shawn, and
  // Daijour" — exactly the same audience canAccessReports already names (Correction brief #8),
  // so this reuses that check rather than inventing a new per-person flag. The period itself
  // (getClosedPayrollPeriod, src/lib/week.ts) is the same for everyone — there's nothing to
  // compute per-actor there, only whether this actor is allowed to see it.
  const canSeeReports = canAccessReports(actor);
  const closedPeriod = getClosedPayrollPeriod();

  const [pendingApprovalsCount, teamNoteCounts, directConversations, reportHours] = await Promise.all([
    admin ? listAdminAvailability(actor).then((r) => r.pending.length) : Promise.resolve(0),
    admin ? listAllTeamNoteTopicCounts(actor) : listTeamNoteTopicCounts(actor, actor.id),
    listConversationSummaries(actor),
    // Same "only ever call the admin/supervisor-gated query when the actor actually qualifies"
    // shape pendingApprovalsCount above already uses — getPayrollHoursReport itself also
    // enforces this with assertCanAccessReports, but there's no reason to round-trip the
    // database for a report this actor isn't allowed to see in the first place.
    canSeeReports
      ? getPayrollHoursReport(actor, new Date(`${closedPeriod.start}T00:00:00`), new Date(`${closedPeriod.end}T00:00:00`))
      : Promise.resolve(null),
  ]);

  const unread =
    teamNoteCounts.reduce((sum, c) => sum + c.unread, 0) +
    directConversations.reduce((sum, c) => sum + c.unread, 0);

  const teamCount = reportHours ? reportHours.rows.filter((r) => r.totalHours > 0).length : 0;

  const [approvalsDismissed, messagesDismissed, reportReadyDismissed] = await Promise.all([
    pendingApprovalsCount > 0 ? isDismissed(actor, approvalsKey(pendingApprovalsCount)) : Promise.resolve(false),
    unread > 0 ? isDismissed(actor, messagesKey(unread)) : Promise.resolve(false),
    canSeeReports ? isDismissed(actor, reportReadyKey(closedPeriod.end)) : Promise.resolve(true),
  ]);

  return {
    approvals: { count: pendingApprovalsCount, show: pendingApprovalsCount > 0 && !approvalsDismissed },
    messages: { unread, show: unread > 0 && !messagesDismissed },
    reportReady: {
      show: canSeeReports && !reportReadyDismissed,
      periodStart: closedPeriod.start,
      periodEnd: closedPeriod.end,
      teamCount,
    },
  };
}

/** Dismisses whichever banner `banner` names, using ITS OWN freshly-computed current count to
 *  build the key — never a count the client hands in, so there's no way to dismiss a count that
 *  isn't actually showing right now. Returns the summary post-dismissal so the caller (the
 *  dismiss API route) can hand the client an up-to-date `show: false` in the same response
 *  instead of making it wait for the next poll. */
export async function dismissDashboardNotification(
  actor: CurrentEmployee,
  banner: "approvals" | "messages" | "reportReady"
): Promise<DashboardNotificationsSummary> {
  const summary = await getDashboardNotificationsSummary(actor);
  if (banner === "approvals" && summary.approvals.count > 0) {
    await dismiss(actor, approvalsKey(summary.approvals.count));
  }
  if (banner === "messages" && summary.messages.unread > 0) {
    await dismiss(actor, messagesKey(summary.messages.unread));
  }
  if (banner === "reportReady" && summary.reportReady.show) {
    await dismiss(actor, reportReadyKey(summary.reportReady.periodEnd));
  }
  return getDashboardNotificationsSummary(actor);
}
