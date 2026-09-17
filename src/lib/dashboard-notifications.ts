import { isAdmin } from "@/lib/authorization";
import { listAdminAvailability } from "@/lib/availability";
import { listTeamNoteTopicCounts, listAllTeamNoteTopicCounts } from "@/lib/team-notes";
import { listConversationSummaries } from "@/lib/direct-messages";
import { isDismissed, dismiss } from "@/lib/dashboard-dismissals";
import type { CurrentEmployee } from "@/types";

export interface DashboardNotificationsSummary {
  approvals: { count: number; show: boolean };
  messages: { unread: number; show: boolean };
}

function approvalsKey(count: number): string {
  return `approvals:${count}`;
}

function messagesKey(count: number): string {
  return `messages:${count}`;
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

  const [pendingApprovalsCount, teamNoteCounts, directConversations] = await Promise.all([
    admin ? listAdminAvailability(actor).then((r) => r.pending.length) : Promise.resolve(0),
    admin ? listAllTeamNoteTopicCounts(actor) : listTeamNoteTopicCounts(actor, actor.id),
    listConversationSummaries(actor),
  ]);

  const unread =
    teamNoteCounts.reduce((sum, c) => sum + c.unread, 0) +
    directConversations.reduce((sum, c) => sum + c.unread, 0);

  const [approvalsDismissed, messagesDismissed] = await Promise.all([
    pendingApprovalsCount > 0 ? isDismissed(actor, approvalsKey(pendingApprovalsCount)) : Promise.resolve(false),
    unread > 0 ? isDismissed(actor, messagesKey(unread)) : Promise.resolve(false),
  ]);

  return {
    approvals: { count: pendingApprovalsCount, show: pendingApprovalsCount > 0 && !approvalsDismissed },
    messages: { unread, show: unread > 0 && !messagesDismissed },
  };
}

/** Dismisses whichever banner `banner` names, using ITS OWN freshly-computed current count to
 *  build the key — never a count the client hands in, so there's no way to dismiss a count that
 *  isn't actually showing right now. Returns the summary post-dismissal so the caller (the
 *  dismiss API route) can hand the client an up-to-date `show: false` in the same response
 *  instead of making it wait for the next poll. */
export async function dismissDashboardNotification(
  actor: CurrentEmployee,
  banner: "approvals" | "messages"
): Promise<DashboardNotificationsSummary> {
  const summary = await getDashboardNotificationsSummary(actor);
  if (banner === "approvals" && summary.approvals.count > 0) {
    await dismiss(actor, approvalsKey(summary.approvals.count));
  }
  if (banner === "messages" && summary.messages.unread > 0) {
    await dismiss(actor, messagesKey(summary.messages.unread));
  }
  return getDashboardNotificationsSummary(actor);
}
