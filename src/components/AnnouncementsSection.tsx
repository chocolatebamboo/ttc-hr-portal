"use client";

import { useState } from "react";
import Link from "next/link";
import SwipeReveal from "@/components/SwipeReveal";
import { MegaphoneIcon, CheckCircleIcon } from "@/components/icons";
import type { AnnouncementDTO } from "@/types";

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function dismissAnnouncement(announcementId: string): Promise<void> {
  try {
    await fetch("/api/announcements/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ announcementId }),
    });
  } catch {
    // best-effort, same fire-and-forget convention DashboardNotifications' dismissBanner uses —
    // worst case the card reappears on the next full page load, which is harmless
  }
}

/**
 * Oct 2026 (CB, circling the "Quick reminder" card that had sat at the top of her Home
 * dashboard for days: "I should be able to clear this notification as well"): a client
 * component now (was a plain server function inline in dashboard/page.tsx) so each card can
 * carry the same SwipeReveal "Clear" gesture DashboardNotifications' own banners and Decided
 * availability cards already use — one consistent swipe-to-dismiss convention app-wide, per
 * Correction brief #1/#9/#10's own instruction that it stay one direction everywhere.
 * Dismissal is real per-employee server state (src/lib/dashboard-dismissals.ts, key
 * `announcement:${id}` — see announcementDismissKey in src/lib/announcements.ts), not a
 * client-only hide — gone for good for this employee, no "Show Again," same rule the
 * approvals/messages banners already follow. The post itself is untouched for everyone else,
 * and still shows up on the full /announcements feed; only this dashboard widget filters it out.
 *
 * `initial` arrives from dashboard/page.tsx already filtered to exclude anything this employee
 * dismissed on a past visit, so a refresh never flashes a just-cleared card back onto the
 * screen before this component's own `clearedNow` state catches up.
 *
 * Featured/others isn't two separate props here (unlike the old version) — it's derived from
 * whichever announcements are still visible after `clearedNow`, so dismissing today's featured
 * card promotes the next one up into that spot immediately instead of leaving a gap where it
 * used to be. Renders nothing at all once nothing's left to show (Oct 2026, same "don't leave an
 * empty box cluttering the home page" rule the other dashboard widgets now follow).
 */
export default function AnnouncementsSection({
  className,
  initial,
}: {
  className?: string;
  initial: AnnouncementDTO[];
}) {
  const [clearedNow, setClearedNow] = useState<Set<string>>(new Set());

  function clear(id: string) {
    setClearedNow((prev) => new Set(prev).add(id));
    dismissAnnouncement(id);
  }

  const visible = initial.filter((a) => !clearedNow.has(a.id));
  if (visible.length === 0) return null;

  const [featured, ...others] = visible;

  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Announcements</h2>
      <div className="space-y-2.5">
        <SwipeReveal
          actionSide="right"
          actionLabel="Clear"
          actionIcon={<CheckCircleIcon className="h-4 w-4" />}
          actionClassName="bg-black/[0.06] text-accent-ink rounded-2xl"
          onAction={() => clear(featured.id)}
        >
          <Link
            href="/announcements"
            className="block rounded-2xl p-4 text-white transition-transform hover:-translate-y-0.5"
            style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-white/80 mb-1.5">
              <MegaphoneIcon className="h-3.5 w-3.5" />
              {formatAnnouncementDate(featured.publishDate)}
            </div>
            <p className="font-semibold text-sm mb-1">{featured.title}</p>
            <p className="text-xs text-white/85 line-clamp-2">{featured.message}</p>
          </Link>
        </SwipeReveal>

        {others.length > 0 && (
          <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
            {others.map((a) => (
              <SwipeReveal
                key={a.id}
                actionSide="right"
                actionLabel="Clear"
                actionIcon={<CheckCircleIcon className="h-4 w-4" />}
                actionClassName="bg-black/[0.06] text-accent-ink"
                actionWidth={72}
                onAction={() => clear(a.id)}
              >
                <Link
                  href="/announcements"
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
                >
                  <span className="truncate">{a.title}</span>
                  <span className="text-muted text-xs whitespace-nowrap shrink-0">
                    {formatAnnouncementDate(a.publishDate)}
                  </span>
                </Link>
              </SwipeReveal>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
