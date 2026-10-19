"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SwipeReveal from "@/components/SwipeReveal";
import { BellIcon, ChatIcon, CheckCircleIcon } from "@/components/icons";
import { formatWeekRange } from "@/lib/week";

export interface DashboardNotificationsSummary {
  approvals: { count: number; show: boolean };
  messages: { unread: number; show: boolean };
  reportReady: { show: boolean; periodStart: string; periodEnd: string; teamCount: number };
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

async function dismissBanner(banner: "approvals" | "messages" | "reportReady"): Promise<void> {
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

type Entry = { key: "approvals" | "messages" | "reportReady"; node: React.ReactNode };

/**
 * CB, Sept 2026: "the ability to exit [things]... notifications" — these are the three banners CB
 * herself calls a "notification." Swiping one away uses the same SwipeReveal "Clear" pattern
 * Messages and Team Availability already use; Oct 2026 (CB, on the report-ready card stuck
 * showing a ten-day-old period: "there's no way to like exit that notification out, like clear
 * it") each banner also carries its own small "x" (DismissButton, below) that fires the exact
 * same dismiss on a plain click — swipe-to-reveal only ever responds to an actual touch/trackpad
 * swipe, which a desktop mouse simply cannot produce, so that was the only way to clear anything
 * on desktop before this.
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
  const [clearedNow, setClearedNow] = useState<Set<"approvals" | "messages" | "reportReady">>(new Set());

  function clear(key: "approvals" | "messages" | "reportReady") {
    setClearedNow((prev) => new Set(prev).add(key));
    dismissBanner(key);
  }

  const entries: Entry[] = [];
  // Round twelve (CB, Oct 2026, on the V1 mockup: "it doesn't really stand out from the rest of
  // the notifications... I need to stand out a little bit more"): leads the stack, ahead of the
  // everyday approvals/messages banners, same as every mockup round showed it.
  if (summary.reportReady.show && !clearedNow.has("reportReady")) {
    entries.push({
      key: "reportReady",
      node: (
        <ReportReadyBanner
          periodStart={summary.reportReady.periodStart}
          periodEnd={summary.reportReady.periodEnd}
          teamCount={summary.reportReady.teamCount}
          onDismiss={() => clear("reportReady")}
        />
      ),
    });
  }
  if (summary.approvals.show && !clearedNow.has("approvals")) {
    entries.push({
      key: "approvals",
      node: <PendingApprovalsBanner count={summary.approvals.count} onDismiss={() => clear("approvals")} />,
    });
  }
  if (summary.messages.show && !clearedNow.has("messages")) {
    entries.push({
      key: "messages",
      node: <MessagesBanner count={summary.messages.unread} onDismiss={() => clear("messages")} />,
    });
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

/**
 * Oct 2026 (CB, pointing at the report-ready card stuck showing a ten-day-old period: "there's no
 * way to like exit that notification out, like clear it"): SwipeReveal's "Clear" action (below)
 * only ever fires off an actual touch/trackpad swipe — scroll-snap has no equivalent for a plain
 * mouse, so on desktop there was genuinely no way to reach it at all. This is a second, always-
 * visible way to trigger the exact same dismiss `onDismiss` (itself just `clear(key)` from the
 * parent, same server-persisted dismissal SwipeReveal's "Clear" already uses) — a plain click,
 * no swipe required, on every device. Swipe-to-clear is untouched and still works; this is
 * additive. Rendered as a sibling of the banner's own `<Link>`, not nested inside it — a `<button>`
 * nested inside an `<a>` is invalid HTML and unreliable with screen readers — so the parent must
 * wrap both in `className="relative"` and the `<Link>` itself must NOT also claim `w-full`'s outer
 * wrapper (each banner below does this).
 */
function DismissButton({ onDismiss, corner = false }: { onDismiss: () => void; corner?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }}
      aria-label="Dismiss"
      className={
        "absolute z-[3] h-6 w-6 rounded-full bg-white/[0.16] hover:bg-white/30 flex items-center justify-center text-white transition-colors " +
        (corner ? "top-3 right-3" : "top-1/2 right-3.5 -translate-y-1/2")
      }
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// CB, Sept 2026: the admin-facing half — "on the administrator that is approving, that should
// be a notification... on their home page saying that this person wants to have that time
// approved."
function PendingApprovalsBanner({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <div className="relative">
      <Link
        href="/admin/availability"
        className="flex items-center gap-3 rounded-2xl pl-4 pr-11 py-3.5 text-white transition-transform hover:-translate-y-0.5 w-full"
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
      <DismissButton onDismiss={onDismiss} />
    </div>
  );
}

// The messaging half — Correction brief #1: "reflect only genuinely unread messages... remove
// the unread-message homepage banner [when there are none]." `count` here is real unread, not
// "ever posted by someone else" (see TeamNoteTopicCountDTO's own comment in src/types/index.ts).
function MessagesBanner({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <div className="relative">
      <Link
        href="/messages"
        className="flex items-center gap-3 rounded-2xl pl-4 pr-11 py-3.5 text-white transition-transform hover:-translate-y-0.5 w-full"
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
      <DismissButton onDismiss={onDismiss} />
    </div>
  );
}

// Fixed burst geometry — not randomized — so this renders identically on the server and the
// client with no hydration mismatch and no need to gate the burst behind a mounted/useEffect
// check. 16 pieces radiating out from the seal badge, spaced evenly around a circle with a
// small per-piece offset baked into the angle/distance/rotation so it doesn't read as a
// perfectly mechanical fan. Values translated straight from the approved V4 mockup's own
// JS-generated burst (report-ready-banner-mockup-v4.html).
const REPORT_READY_CONFETTI_COLORS = ["#ffffff", "#ffd166", "#ed008c", "#8ecae6"];
const REPORT_READY_CONFETTI = Array.from({ length: 16 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 16 + ((i % 3) - 1) * 0.08;
  const dist = 55 + ((i * 37) % 70);
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist * 0.6 - 12;
  return {
    color: REPORT_READY_CONFETTI_COLORS[i % REPORT_READY_CONFETTI_COLORS.length],
    end: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`,
    rot: `${(i * 53) % 360}deg`,
    delay: `${0.05 + ((i * 7) % 20) / 100}s`,
  };
});
const REPORT_READY_SPARKLES = [
  { left: 5, top: 10, size: 11, delay: "0.6s" },
  { left: 55, top: 4, size: 8, delay: "0.72s" },
  { left: 175, top: 16, size: 9, delay: "0.84s" },
];

type ConfettiPieceStyle = React.CSSProperties & {
  "--report-ready-end": string;
  "--report-ready-rot": string;
};

function ReportReadyConfetti() {
  return (
    <>
      {REPORT_READY_CONFETTI.map((piece, i) => (
        <span
          key={i}
          className="report-ready-confetti-piece"
          aria-hidden="true"
          style={
            {
              left: "37px",
              background: piece.color,
              animationDelay: piece.delay,
              "--report-ready-end": piece.end,
              "--report-ready-rot": piece.rot,
            } as ConfettiPieceStyle
          }
        />
      ))}
      {REPORT_READY_SPARKLES.map((s, i) => (
        <span
          key={i}
          className="report-ready-sparkle"
          aria-hidden="true"
          style={{ left: s.left, top: s.top, animationDelay: s.delay }}
        >
          <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="white">
            <path d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4z" />
          </svg>
        </span>
      ))}
    </>
  );
}

/**
 * CB, Oct 2026: "when the two week report comes in on that Friday morning I want... something
 * aesthetic and animated... like a celebration but still clean aesthetic to what we currently
 * have." Reserved for exactly the audience canAccessReports already names (CB, correcting the
 * first draft scope: "that's only for me Shawn and Daijour") — gated server-side in
 * getDashboardNotificationsSummary, never rendered here for anyone else.
 *
 * Seven mockup rounds (CB's own words each time): V1's thin pill "doesn't really stand out...
 * besides that pink gradient"; V2's bigger standalone card with a serif headline and a real
 * badge; V3's centered layout with a solid-seal checkmark badge ("a symbol is what I meant to
 * say"); V4 back to left-aligned ("there's too much space up top and it needs to be left
 * aligned") but keeping V3's seal badge and V2's tighter card padding; V5, on V4: bigger
 * title/subtitle and tighter side padding ("I don't like the empty spaces on the sides"); V6
 * tried dropping the white circle for a bare chart-bars icon (CB: the checkmark "feels like you
 * have to click that"); V7 — this one — keeps the circle after all, just with that same
 * chart-bars glyph (the app's own Reports icon, see ChartIcon/StatCard on this dashboard)
 * swapped in for the checkmark. Tapping the card deep-links straight into that closed period's
 * report (ReportsView's own `?periodEnd=` read), the same "land directly on the right range"
 * convention the unapproved-entries banner already uses with `?week=`.
 */
function ReportReadyBanner({
  periodStart,
  periodEnd,
  teamCount,
  onDismiss,
}: {
  periodStart: string;
  periodEnd: string;
  teamCount: number;
  onDismiss: () => void;
}) {
  return (
    <div className="relative">
      <Link
        href={`/admin/reports?periodEnd=${periodEnd}`}
        className="report-ready-card relative block overflow-hidden rounded-3xl px-[13px] py-4 text-white transition-transform hover:-translate-y-0.5 w-full"
        style={{
          boxShadow:
            "0 10px 30px -6px color-mix(in srgb, var(--ttc-pink-ink) 45%, transparent), 0 2px 8px rgba(0,0,0,0.08)",
          background:
            "radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,0.16), transparent 55%), linear-gradient(135deg, var(--ttc-blue-ink) 0%, var(--ttc-blue) 48%, var(--ttc-pink) 100%)",
        }}
      >
        <span className="report-ready-glow" aria-hidden="true" />
        <ReportReadyConfetti />
        <div className="relative z-[2] flex items-center gap-[11px] pr-7">
          <span className="relative shrink-0">
            <span className="report-ready-seal-ring absolute -inset-1 rounded-full border-[1.5px] border-white/50" aria-hidden="true" />
            <span className="report-ready-seal flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.16)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ttc-pink-ink)" strokeWidth="2.3" aria-hidden="true">
                <path d="M3.5 20.5h17" strokeLinecap="round" />
                <path d="M6.5 20.5v-6M12 20.5V7M17.5 20.5v-9.5" strokeLinecap="round" />
              </svg>
            </span>
          </span>
          <div className="min-w-0">
            <div className="font-serif text-[1.36rem] font-bold leading-[1.12] tracking-[-0.01em] truncate">
              Two-week report is ready
            </div>
            <div className="mt-[3px] truncate text-[0.89rem] text-white/80">{formatWeekRange(periodStart, periodEnd)} wrapped up</div>
          </div>
        </div>
        <div className="relative z-[2] my-3 h-px bg-white/20" />
        <div className="relative z-[2] flex items-center justify-between gap-3">
          <span className="text-[0.78rem] text-white/80">
            <b className="font-bold text-white">{teamCount}</b> team {teamCount === 1 ? "member" : "members"} logged time
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white px-3.5 py-1.5 text-[0.78rem] font-bold text-[color:var(--ttc-pink-ink)]">
            View report
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </Link>
      <DismissButton onDismiss={onDismiss} corner />
    </div>
  );
}
