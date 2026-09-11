"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SwipeReveal from "@/components/SwipeReveal";
import { BellIcon, ChatIcon, CheckCircleIcon } from "@/components/icons";

type Entry = { key: string; node: React.ReactNode };

function storageKeyFor(employeeId: string) {
  return `ttc:dismissed-notifications:${employeeId}`;
}

function readDismissed(employeeId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(employeeId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(employeeId: string, dismissed: Set<string>) {
  try {
    window.localStorage.setItem(storageKeyFor(employeeId), JSON.stringify([...dismissed]));
  } catch {
    // best-effort — a notification that won't stay dismissed isn't worth failing the page over
  }
}

/**
 * CB, Sept 2026: "the ability to exit [things]... notifications" — these are the two banners
 * CB herself calls a "notification" (round four/five: "on the administrator that is approving,
 * that should be a notification," and this round's messages banner). Swiping one away uses the
 * same SwipeReveal "Clear" pattern Messages and Team Availability already use.
 *
 * Dismissing is per-browser (localStorage, keyed by employee) rather than a real read/unread
 * system on the server — nothing new to migrate, nothing to keep in sync across devices.
 * "Recoverable" (not deleted): the "show again" link below brings back everything currently
 * hidden. Keys are content-based (the exact pending count, the exact message count) so a *new*
 * notification — the count went up, or changed after being cleared — always shows again even if
 * an earlier one in the same slot was dismissed; it's genuinely different information, not the
 * same notification reappearing.
 */
export default function DashboardNotifications({
  className,
  employeeId,
  showApprovals,
  pendingApprovalsCount,
  messagesCount,
}: {
  className?: string;
  employeeId: string;
  showApprovals: boolean;
  pendingApprovalsCount: number;
  messagesCount: number;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // One-time hydration from localStorage — same fetch-on-mount-then-setState shape used
  // throughout this codebase (e.g. OnboardingView's own load() effects), just reading from
  // localStorage instead of the network.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(readDismissed(employeeId));
    setHydrated(true);
  }, [employeeId]);

  function dismiss(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      writeDismissed(employeeId, next);
      return next;
    });
  }

  function restoreAll() {
    setDismissed(new Set());
    writeDismissed(employeeId, new Set());
  }

  const entries: Entry[] = [];
  if (showApprovals && pendingApprovalsCount > 0) {
    entries.push({
      key: `approvals:${pendingApprovalsCount}`,
      node: <PendingApprovalsBanner count={pendingApprovalsCount} />,
    });
  }
  if (messagesCount > 0) {
    entries.push({ key: `messages:${messagesCount}`, node: <MessagesBanner count={messagesCount} /> });
  }

  // Nothing rendered until the dismissed set is read from localStorage — avoids a flash of a
  // banner that's about to disappear (or vice versa) on the very first paint.
  if (!hydrated) return null;

  const visible = entries.filter((e) => !dismissed.has(e.key));
  const hiddenCount = entries.length - visible.length;

  if (visible.length === 0 && hiddenCount === 0) return null;

  return (
    <div className={className}>
      <div className="space-y-3">
        {visible.map((e) => (
          <SwipeReveal
            key={e.key}
            actionSide="left"
            actionLabel="Clear"
            actionIcon={<CheckCircleIcon className="h-4 w-4" />}
            actionClassName="bg-black/[0.06] text-accent-ink rounded-2xl"
            onAction={() => dismiss(e.key)}
          >
            {e.node}
          </SwipeReveal>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={restoreAll}
          className="mt-2 text-xs font-medium text-muted hover:text-accent-ink underline underline-offset-2"
        >
          {hiddenCount} cleared — show again
        </button>
      )}
    </div>
  );
}

// CB, Sept 2026: the admin-facing half — "on the administrator that is approving, that should
// be a notification... on their home page saying that this person wants to have that time
// approved." Moved here (from dashboard/page.tsx) so it can be wrapped in the swipe-to-clear
// above; otherwise unchanged from the original "shows while true" version.
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

// CB, Sept 2026: the other half of the messaging feature. Moved here (from dashboard/page.tsx)
// for the same reason as PendingApprovalsBanner above — otherwise unchanged.
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
