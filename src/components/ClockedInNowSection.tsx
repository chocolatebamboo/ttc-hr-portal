"use client";

import { useCallback, useEffect, useState } from "react";
import { formatClockTime, formatElapsedClock } from "@/lib/time";
import { formatTime12h } from "@/lib/availability-format";
import { WarningIcon } from "@/components/icons";
import type { CurrentlyClockedInRowDTO } from "@/types";

// Same "server-rendered initial, then poll" interval DashboardNotifications.tsx already uses —
// no websocket/SSE infrastructure exists anywhere else in this app, and a clock-in doesn't need
// to appear here instantaneously, just "without a manual page refresh."
const POLL_MS = 30_000;

function useLiveNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * "Clocked in now" (CB, Oct 2026): "were supposed to see the clock running when the team clocks
 * in, that is very important" — raised together with a report that Donique's clock-out "didn't
 * record at all." Direct database inspection showed her session actually recorded correctly end
 * to end; the real gap was that nothing anywhere showed a supervisor/admin which team members
 * are ACTUALLY clocked in at a given moment — only who's SCHEDULED to be (TeamScheduleGlance,
 * fed by listAdminShifts' schedule math), which is a different thing entirely from a real clock
 * punch. This reads real TimeSession rows (listCurrentlyClockedIn, src/lib/attendance-admin.ts)
 * and ticks each one's elapsed time every second — same "visibly moving = visibly being
 * tracked" fix as TimeClockCard's own new running timer, so a glance at this card is itself the
 * confirmation that the system is recording someone's time right now, not just a number someone
 * has to trust is current.
 *
 * `initial` comes from the dashboard server page's own listCurrentlyClockedIn call (no flash of
 * "Nobody clocked in" on first paint while the client fetch is still in flight); this component
 * re-polls GET /api/team/clocked-in afterward to pick up clock-ins/outs from other tabs/devices.
 * Admin sees every active employee; a Supervisor sees only their own direct reports — scoped
 * server-side in listCurrentlyClockedIn, identically for both the initial fetch and every poll.
 */
export default function ClockedInNowSection({
  initial,
  className,
}: {
  initial: CurrentlyClockedInRowDTO[];
  className?: string;
}) {
  const [rows, setRows] = useState(initial);
  const now = useLiveNow();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/clocked-in");
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.rows);
    } catch {
      // best-effort — same "quietly skip this tick" convention DashboardNotifications uses
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Oct 2026 (CB, circling this exact "Nobody is clocked in right now" box on her Home
  // dashboard: "if there isn't anything currently in the field then we shouldn't see it at all
  // cause its cluttering the home page"): the whole section (header, Live badge, body) now
  // disappears instead of showing an empty-state box. This is a real return inside the
  // component itself, not a conditional wrapper in dashboard/page.tsx, so the 30s poll above
  // can still bring it back the instant someone actually clocks in without the parent page
  // needing to know that happened. Same call TeamScheduleGlance/TimeOffSection/
  // AvailabilityStatusSection now make for their own empty states, all on this same page.
  if (rows.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-muted">Clocked in now</h2>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          Live
        </span>
      </div>

      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {rows.map((r) => {
          const elapsedMs = Math.max(0, now.getTime() - new Date(r.clockIn).getTime());
          return (
            <div key={r.sessionId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{r.name}</p>
                <p className="text-xs text-muted truncate">
                  {r.jobTitle}
                  {r.department ? ` · ${r.department}` : ""}
                </p>
                {r.isException && (
                  <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-700">
                    <WarningIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Flagged{r.exceptionReason ? `: ${r.exceptionReason}` : ""}</span>
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="tabular-nums font-semibold">{formatElapsedClock(elapsedMs)}</p>
                <p className="text-xs text-muted mt-0.5">since {formatClockTime(r.clockIn)}</p>
                {/* CB, Oct 2026, circling this card: "make sure we see the schedule of the
                    person that's scheduled here on the clock while the clock is running." Null
                    for an unscheduled/ad-hoc clock-in — nothing on the books for them today — so
                    this line just doesn't render rather than showing a dash. */}
                {r.scheduledStartTime && r.scheduledEndTime && (
                  <p className="text-xs text-muted mt-0.5">
                    Scheduled {formatTime12h(r.scheduledStartTime)} – {formatTime12h(r.scheduledEndTime)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
