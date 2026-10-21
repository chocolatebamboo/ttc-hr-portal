"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { combineDateAndTime, formatClockTime, formatElapsedClock } from "@/lib/time";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import { WarningIcon, MoreIcon } from "@/components/icons";
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
 *
 * Oct 2026 (CB, looking at Donique's card running 5h21m past her scheduled end: "I feel like
 * there should be kind of an option... from an admin perspective... to stop it and correct it"):
 * `canForceClockOut` adds a small kebab button to each row — straight through from
 * employee.canEditFlaggedTimeEntries, the same per-person flag CB's existing "Edit times"
 * capability on an already-closed day already uses, restricted to just her and Shawn. Everyone
 * else sees this card exactly as it looked before. Tapping it opens ClockOutSheet below, which
 * force-closes that one session (POST /api/time/sessions/[id]/force-clock-out) — a row simply
 * drops out of `rows` on success, same as it would once a 30s poll notices the real clock-out.
 */
export default function ClockedInNowSection({
  initial,
  canForceClockOut,
  className,
}: {
  initial: CurrentlyClockedInRowDTO[];
  canForceClockOut: boolean;
  className?: string;
}) {
  const [rows, setRows] = useState(initial);
  const now = useLiveNow();
  const [openSheetSessionId, setOpenSheetSessionId] = useState<string | null>(null);

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
              <div className="flex items-start gap-2 shrink-0">
                <div className="text-right">
                  <p className="tabular-nums font-semibold">{formatElapsedClock(elapsedMs)}</p>
                  <p className="text-xs text-muted mt-0.5">since {formatClockTime(r.clockIn)}</p>
                  {/* CB, Oct 2026, circling this card: "make sure we see the schedule of the
                      person that's scheduled here on the clock while the clock is running." Null
                      for an unscheduled/ad-hoc clock-in — nothing on the books for them today —
                      so this line just doesn't render rather than showing a dash. */}
                  {r.scheduledStartTime && r.scheduledEndTime && (
                    <p className="text-xs text-muted mt-0.5">
                      Scheduled {formatTime12h(r.scheduledStartTime)} – {formatTime12h(r.scheduledEndTime)}
                    </p>
                  )}
                </div>
                {canForceClockOut && (
                  <button
                    type="button"
                    onClick={() => setOpenSheetSessionId(r.sessionId)}
                    aria-label={`Clock ${r.name} out`}
                    className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-muted hover:bg-black/[0.03] shrink-0"
                  >
                    <MoreIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openSheetSessionId &&
        (() => {
          const row = rows.find((r) => r.sessionId === openSheetSessionId);
          // The row it was opened for just closed out from under it (another device/tab, or the
          // 30s poll) — nothing left to act on, so just drop the sheet instead of showing it
          // pointed at stale data.
          if (!row) return null;
          return (
            <ClockOutSheet
              row={row}
              now={now}
              onClose={() => setOpenSheetSessionId(null)}
              onDone={() => {
                setOpenSheetSessionId(null);
                load();
              }}
            />
          );
        })()}
    </div>
  );
}

/** The sheet ClockedInNowSection opens for its "Clock out" action above — same bottom-sheet
 *  shape (grab handle, rounded-t-3xl on mobile/rounded-2xl at sm+, portaled straight onto
 *  document.body) as ScheduleSomeoneSheet right next to this on the Home dashboard, including
 *  the SAME reason for the portal: this renders inside dashboard/page.tsx's `animate-in`
 *  wrapper, whose fade-up keyframe leaves a non-none `transform` applied (fill mode `both`) even
 *  once it's finished, and a `transform` on an ancestor creates a new containing block for any
 *  `position: fixed` descendant — without the portal this sheet sizes itself against that small
 *  wrapper div instead of the real viewport. See ScheduleSomeoneSheet's own doc comment for the
 *  fuller history of that bug.
 *
 *  Two one-tap options (Now / Scheduled end) plus a plain <input type="time"> for anything else
 *  — same "use the schedule, not just whatever time it happens to be" idea
 *  autoCloseStaleClockIns (src/lib/auto-clockout.ts) already applies on its own once 4 hours
 *  have passed, just reachable immediately and with a free-typed override. Time values stay in
 *  the browser's own local time throughout (same convention toTimeInputValue/combineDateAndTime
 *  already use for the "Edit times" correction form in TimesheetTable.tsx), combined against the
 *  clock-in's own calendar day rather than today's — identical in the overwhelming common case
 *  (no shift at TTC spans midnight) but correct if this sheet is ever opened after midnight for a
 *  session that started the evening before. */
function ClockOutSheet({
  row,
  now,
  onClose,
  onDone,
}: {
  row: CurrentlyClockedInRowDTO;
  now: Date;
  onClose: () => void;
  onDone: () => void;
}) {
  const clockInDate = new Date(row.clockIn);
  const dayKey = `${clockInDate.getFullYear()}-${String(clockInDate.getMonth() + 1).padStart(2, "0")}-${String(
    clockInDate.getDate()
  ).padStart(2, "0")}`;
  const nowTimeValue = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const [mode, setMode] = useState<"now" | "scheduled" | "custom">("now");
  const [customTime, setCustomTime] = useState(nowTimeValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const timeValue = mode === "scheduled" && row.scheduledEndTime ? row.scheduledEndTime : mode === "custom" ? customTime : nowTimeValue;

  async function handleSubmit() {
    const clockOut = mode === "now" ? now : combineDateAndTime(dayKey, timeValue);
    if (!clockOut) return;

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/time/sessions/${row.sessionId}/force-clock-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clockOut: clockOut.toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't clock them out. Please try again.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clock them out. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-border mx-auto mb-4" />
        <p className="text-base font-semibold mb-1">Clock {row.name} out</p>
        <p className="text-xs text-muted mb-4">
          Stops their live clock now and records this as their clock-out time. Only you and Shawn can do this.
        </p>

        <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2.5 text-sm mb-4">
          <span className="text-muted">Clocked in since</span>
          <span className="font-semibold">
            {formatSlotDate(dayKey)} · {formatClockTime(row.clockIn)}
          </span>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/70 mb-1.5">Clock-out time</p>
        <input
          type="time"
          value={timeValue}
          onChange={(e) => {
            setMode("custom");
            setCustomTime(e.target.value);
          }}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-base font-semibold tabular-nums"
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => setMode("now")}
            className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-semibold ${
              mode === "now" ? "bg-accent border-accent text-white" : "border-border text-accent-ink"
            }`}
          >
            Now · {formatTime12h(nowTimeValue)}
          </button>
          {row.scheduledEndTime && (
            <button
              type="button"
              onClick={() => setMode("scheduled")}
              className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-semibold ${
                mode === "scheduled" ? "bg-accent border-accent text-white" : "border-border text-accent-ink"
              }`}
            >
              Scheduled end · {formatTime12h(row.scheduledEndTime)}
            </button>
          )}
        </div>

        {error && <p className="text-sm text-accent mt-3">{error}</p>}

        <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary w-full mt-4 min-h-[48px]">
          {submitting ? "Clocking out…" : "Clock out & correct"}
        </button>
        <button type="button" onClick={onClose} className="w-full mt-2 text-sm font-medium text-muted py-2">
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}
