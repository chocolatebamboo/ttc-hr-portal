"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon, TrashIcon } from "@/components/icons";
import SwipeReveal from "@/components/SwipeReveal";
import type { NotificationDTO, NotificationType } from "@/types";

/**
 * Phase 4 (client spec, Sept 2026): "a real in-app notification feed." The header bell — a
 * discrete, server-tracked read/unread list of individual events, distinct from
 * DashboardNotifications.tsx's own two aggregate "pending count" banners (those stay exactly as
 * they are; this is additive). Modeled on ProfileMenu.tsx's own dropdown shape (useRef root +
 * pointerdown/Escape-to-close effect, role="menu"), just with a badge instead of an avatar and a
 * scrollable list instead of two menu items.
 *
 * Polls GET /api/notifications on an interval rather than opening a live connection — this app
 * has no websocket/SSE infrastructure anywhere else, and a 45s poll is more than enough freshness
 * for "someone approved your shift change" to feel prompt without adding new infrastructure for
 * just this one feature.
 *
 * Phase 5a (CB, Sept 2026): "we should be able to swipe left to clear notifications one at a
 * time, with a separate option to clear all notifications." Each row is wrapped in the same
 * SwipeReveal component the rest of the app already uses for this exact gesture (Time Off, PTO,
 * Messages), so the interaction is familiar; the revealed action button itself is a smaller
 * rounded-square floating button rather than the app's usual edge-to-edge swipe action (CB's own
 * call on this one) via actionClassName's own margin/rounding rather than a new SwipeReveal
 * variant, so every other swipe-to-delete row in this app is unaffected. "Clear all" is a real
 * delete (deleteAllNotifications), kept separate from the existing "Mark all read" (renamed from
 * this file's old, confusingly-named handleClearAll) which only changes read state.
 */
const POLL_MS = 45_000;

// Where clicking a notification should take you — keyed by targetType, with one override for
// SHIFT_REQUEST_RECEIVED (the one Shift-targeted type whose recipient is the admin/supervisor who
// created the shift, reviewing someone else's request, not the shift's own employee looking at
// their schedule).
function targetHref(n: NotificationDTO): string {
  if (n.targetType === "Shift") {
    return n.type === "SHIFT_REQUEST_RECEIVED" ? "/team/schedule" : "/schedule";
  }
  if (n.targetType === "AvailabilitySubmission") return "/availability";
  if (n.targetType === "PtoRequest") return "/time-off";
  if (n.targetType === "DateTask") return "/dashboard";
  return "/dashboard";
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TYPE_TONE: Record<NotificationType, "positive" | "negative" | "neutral"> = {
  SHIFT_CREATED: "neutral",
  SHIFT_CANCELLED: "negative",
  SHIFT_REASSIGNED: "neutral",
  SHIFT_CHANGE_APPROVED: "positive",
  SHIFT_REQUEST_DECLINED: "negative",
  SHIFT_REQUEST_RECEIVED: "neutral",
  AVAILABILITY_APPROVED: "positive",
  AVAILABILITY_DENIED: "negative",
  AVAILABILITY_ADJUSTMENT_PROPOSED: "neutral",
  PTO_APPROVED: "positive",
  PTO_DENIED: "negative",
  DATE_TASK_ASSIGNED: "neutral",
  DATE_TASK_APPROVED: "positive",
  DATE_TASK_RETURNED: "negative",
};

function Dot({ tone }: { tone: "positive" | "negative" | "neutral" }) {
  const color = tone === "positive" ? "bg-green-500" : tone === "negative" ? "bg-red-500" : "bg-accent";
  return <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${color}`} />;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // Which single notification's swipe-delete is in flight — narrows the busy state to just that
  // row's own revealed button, same scoping every other per-row busy flag in this app uses.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
      setLoaded(true);
    } catch {
      // best-effort — the bell just quietly doesn't update this tick
    }
  }, []);

  useEffect(() => {
    // Initial fetch-on-mount, same shape as ReportsView/ActivityHistoryView's own
    // generate()-on-mount effects.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleClick(n: NotificationDTO) {
    setOpen(false);
    if (!n.read) {
      // Optimistic — the dropdown is about to close anyway, and markNotificationRead is a
      // best-effort fire-and-forget same as MessagesBanner's own dismissal pattern.
      setNotifications((prev) => prev.map((row) => (row.id === n.id ? { ...row, read: true } : row)));
      setUnreadCount((c) => Math.max(0, c - 1));
      fetch(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    }
    router.push(targetHref(n));
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((row) => ({ ...row, read: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  async function handleDeleteOne(n: NotificationDTO) {
    setDeletingId(n.id);
    try {
      const res = await fetch(`/api/notifications/${n.id}`, { method: "DELETE" });
      if (res.ok) {
        setNotifications((prev) => prev.filter((row) => row.id !== n.id));
        if (!n.read) setUnreadCount((c) => Math.max(0, c - 1));
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleClearAll() {
    setClearingAll(true);
    try {
      const res = await fetch("/api/notifications/clear-all", { method: "POST" });
      if (res.ok) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
        className="relative flex items-center justify-center h-9 w-9 rounded-full hover:bg-black/[0.03] transition-colors"
      >
        <BellIcon className="h-5 w-5 text-foreground" />
        {loaded && unreadCount > 0 && (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-xl border border-border bg-surface shadow-lg py-1.5 z-30"
        >
          <div className="flex items-center justify-between px-3.5 py-2">
            <p className="text-sm font-medium">Notifications</p>
            <div className="flex items-center gap-2.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs font-medium text-muted hover:text-accent-ink"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  className="text-xs font-medium text-accent-ink hover:text-accent disabled:opacity-60"
                >
                  {clearingAll ? "Clearing…" : "Clear all"}
                </button>
              )}
            </div>
          </div>

          <div className="my-1 border-t border-border" />

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3.5 py-6 text-sm text-muted text-center">You&apos;re all caught up.</p>
            ) : (
              notifications.map((n) => (
                <SwipeReveal
                  key={n.id}
                  actionSide="right"
                  actionLabel="Delete"
                  actionIcon={<TrashIcon className="h-4 w-4" />}
                  actionClassName="bg-rose-600 text-white rounded-2xl my-2 mr-2 ml-1"
                  actionWidth={72}
                  busy={deletingId === n.id}
                  onAction={() => handleDeleteOne(n)}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleClick(n)}
                    className={`w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-black/[0.03] ${
                      n.read ? "" : "bg-accent/[0.04]"
                    }`}
                  >
                    <Dot tone={TYPE_TONE[n.type]} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${n.read ? "text-foreground" : "font-medium text-foreground"}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[11px] text-muted mt-1">{relativeTime(n.createdAt)}</p>
                    </div>
                  </button>
                </SwipeReveal>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
