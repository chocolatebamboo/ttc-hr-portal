"use client";

import { useRouter } from "next/navigation";

/**
 * Oct 2026 (CB, on /team/[employeeId]'s old "← My Team" link, which always pointed at /team no
 * matter where the admin actually came from — the dashboard's "Who's working right now"/"Today"
 * rows link here too, and TeamScheduleGlance's "Upcoming" rows land on a different page
 * entirely): "it needs to say like back or something... it should function like it's going back
 * to the original place that we clicked for us to even get into that page." router.back() walks
 * the browser's own history, so it returns to wherever actually sent the browser here — My Team,
 * the dashboard, Team Schedule, wherever — instead of hard-coding one destination.
 *
 * `fallbackHref` covers the one case browser history can't: landing here with nothing before it
 * in this tab's history (a bookmark, a pasted link, a fresh tab) — `window.history.length > 1`
 * is the standard (if imperfect) signal there's actually somewhere to go back to; without that
 * check, router.back() on a fresh tab would just leave the portal entirely rather than do
 * nothing or error.
 */
export default function BackLink({ fallbackHref, label = "Back" }: { fallbackHref: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="text-sm text-muted hover:text-accent-ink mb-3 inline-block"
    >
      ← {label}
    </button>
  );
}
