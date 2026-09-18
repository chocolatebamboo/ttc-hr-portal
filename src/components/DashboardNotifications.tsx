"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SwipeReveal from "@/components/SwipeReveal";
import { BellIcon, ChatIcon, CheckCircleIcon } from "@/components/icons";

export interface DashboardNotificationsSummary {
  approvals: { count: number; show: boolean };
  messages: { unread: number; show: boolean };
}

// Same polling interval and "poll GET, fire-and-forget POST" shape NotificationBell.tsx already
// uses for the header bell — no websocket/SSE infrastructure exists anywhere else in this app,
// and Correction brief #1 only asks that counts "update without requiring a manual page
// refresh," not that they update instantly.
const POLL_MS = 45_000;

/**
 * Correction brief (Sept 2026, "Correction & Refinement Brief" #1): shared by DashboardNotifications
 * (the banners, below) and MessagesBadgeLink (the header chat-icon shortcut, also below) — both
 * need the exact same live counts, so both start from the server-computed `initial` (no flash of
 * a stale/zero count on first paint) and then independently poll GET /api/dashboard/notifications
 * for updates. Two small independent polls of one lightweight endpoint is a fine tradeoff at this
 * company's size — see src/lib/dashboard-notifications.ts's own "fine at this company's size"
 * precedent — and it avoids threading shared state across two unrelated spots in dashboard/page.tsx's
 * JSX (the badge sits in the header row; the banners sit in their own block below it).
 */
export function useDashboardNotifications(initial: DashboardNotificationsSummary): DashboardNotificationsSummary {
  const [summary, setSummary] = useState<DashboardNotificationsSummary>(initial);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/notifications");
      if (!res.ok) return;
      const data: DashboardNotificationsSummary = await res.json();
      setSummary(data);
    } catch {
      // best-effort — same "quietly skip this tick" convention NotificationBell.tsx uses
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return summary;
}

/** The dashboard header's "Messages" shortcut — CB, Sept 2026: "an icon on the home dashboard to
 *  kinda signify that we got a message." Was static server-rendered markup inline in
 *  dashboard/page.tsx; moved here so it can share live polling with the banner below instead of
 *  only reflecting whatever the count was at the last full page load. */
export function MessagesBadgeLink({ initial }: { initial: DashboardNotificationsSummary }) {
  const { messages } = useDashboardNotifications(initial);
  return (
    <Link
      href="/messages"
      className="relative shrink-0 h-10 w-10 rounded-full bg-surface border border-border flex items-center justify-center hover:bg-black/[0.03] transition-colors"
      title="Messages"
    >
      <ChatIcon className="h-5 w-5 text-muted" />
      {messages.unread > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
          style={{ background: "#8b5cf6" }}
        >
          {messages.unread > 9 ? "9+" : messages.unread}
        </span>
      )}
    </Link>
  );
}

async function dismissBanner(banner: "approvals" | "messages"): Promise<void> {
  try {
    await fetch("/api/dashboard/notifications/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banner }),
    });
  } catch {
    // best-effort, same fire-and-forget convention NotificationBell.tsx's handleClick uses —
    // worst case the banner reappears on the next poll, which is harmless
  }
}

type Entry = { key: "approvals" | "messages"; node: React.ReactNode };

/**
 * CB, Sept 2026: "the ability to exit [things]... notifications" — these are the two banners CB
 * herself calls a "notification." Swiping one away uses the same SwipeReveal "Clear" pattern
 * Messages and Team Availability already use.
 *
 * Correction brief #1/#9 (this round): dismissal is now real server state
 * (src/lib/dashboard-dismissals.ts), not localStorage — it persists across refresh, logout,
 * login, and devices, and there is deliberately no "show again" recovery path. A dismissed
 * banner reappears on its own the instant the underlying count is genuinely different (a new
 * pending request, a new unread message), because the dismissal key is derived from the exact
 * count being dismissed — see src/lib/dashboard-notifications.ts.
 */
export default function DashboardNotifications({
  className,
  initial,
}: {
  className?: string;
  initial: DashboardNotificationsSummary;
}) {
  const summary = useDashboardNotifications(initial);
  // Optimistic local hide the instant Clear is tapped, so the banner doesn't wait for the
  // dismiss POST to resolve (or the next 45s poll) to disappear — same "update local state
  // immediately, persist in the background" shape NotificationBell.tsx's handleClick uses.
  const [clearedNow, setClearedNow] = useState<Set<"approvals" | "messages">>(new Set());

  function clear(key: "approvals" | "messages") {
    setClearedNow((prev) => new Set(prev).add(key));
    dismissBanner(key);
  }

  const entries: Entry[] = [];
  if (summary.approvals.show && !clearedNow.has("approvals")) {
    entries.push({ key: "approvals", node: <PendingApprovalsBanner count={summary.approvals.count} /> });
  }
  if (summary.messages.show && !clearedNow.has("messages")) {
    entries.push({ key: "messages", node: <MessagesBanner count={summary.messages.unread} /> });
  }

  if (entries.length === 0) return null;

  return (
    <div className={className}>
      <div className="space-y-3">
        {entries.map((e) => (
          <SwipeReveal
            key={e.key}
            actionSide="right"
            actionLabel="Clear"
            actionIcon={<CheckCircleIcon className="h-4 w-4" />}
            actionClassName="bg-black/[0.06] text-accent-ink rounded-2xl"
            onAction={() => clear(e.key)}
          >
            {e.node}
          </SwipeReveal>
        ))}
      </div>
    </div>
  );
}

// CB, Sept 2026: the admin-facing half — "on the administrator that is approving, that should
// be a notification... on their home page saying that this person wants to have that time
// approved."
function PendingApprovalsBanner({ count }: { count: number }) {
  return (
    <Link
      href="/admin/availability"
      className="flex items-center gap-3 rounded-2xl px-4 py-3.5 text-white transition-transform hover:-translate-y-0.5 w-full"
      style={{ background: "linear-gradient(135deg, var(--ttc-blue-ink), var(--ttc-blue))" }}
    >
      <span className="h-9 w-9 shrink-0 rounded-full bg-white/15 flex items-center justify-center">
        <BellIcon className="h-4.5 w-4.5" />
      </span>
      <p className="text-sm font-medium">
        {count} availability {count === 1 ? "request" : "requests"} waiting for your review
      </p>
      <span className="ml-auto text-xs font-medium whitespace-nowrap shrink-0 opacity-90">Review →</span>
    </Link>
  );
}

// The messaging half — Correction brief #1: "reflect only genuinely unread messages... remove
// the unread-message homepage banner [when there are none]." `count` here is real unread, not
// "ever posted by someone else" (see TeamNoteTopicCountDTO's own comment in src/types/index.ts).
function MessagesBanner({ count }: { count: number }) {
  return (
    <Link
      href="/messages"
      className="flex items-center gap-3 rounded-2xl px-4 py-3.5 text-white transition-transform hover:-translate-y-0.5 w-full"
      style={{ background: "linear-gradient(135deg, #6d28d9, #8b5cf6)" }}
    >
      <span className="h-9 w-9 shrink-0 rounded-full bg-white/15 flex items-center justify-center">
        <ChatIcon className="h-4.5 w-4.5" />
      </span>
      <p className="text-sm font-medium">
        {count} new {count === 1 ? "message" : "messages"} waiting for you
      </p>
      <span className="ml-auto text-xs font-medium whitespace-nowrap shrink-0 opacity-90">View →</span>
    </Link>
  );
}
