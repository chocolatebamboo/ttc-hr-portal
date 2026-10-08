"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { ChecklistIcon } from "@/components/icons";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import { getWeek, formatWeekRange } from "@/lib/week";
import type { ShiftDTO, ShiftStatus } from "@/types";

type LoadState = "loading" | "ready" | "error";

// Same color logic ShiftStatusPill's own STYLE map already uses (sky = upcoming, emerald =
// happening now, muted = closed out, amber = a pending request, violet = reassigned, rose =
// no clock-in) — reused here as a left-edge accent bar on each card instead of invented fresh,
// so a status reads the same way whether you're looking at its pill or its card.
const ACCENT: Record<ShiftStatus, string> = {
  UPCOMING: "#0ea5e9",
  IN_PROGRESS: "#10b981",
  COMPLETED: "rgba(107,101,96,0.35)",
  CHANGE_REQUESTED: "#f59e0b",
  CANCELLATION_REQUESTED: "#f59e0b",
  CANCELLED: "rgba(107,101,96,0.35)",
  REASSIGNED: "#8b5cf6",
  MISSED: "#f43f5e",
};

/**
 * "My Schedule" — phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): the
 * confirmed-Shift counterpart to My Availability. Deliberately separate pages/records: this
 * shows only what a supervisor has actually scheduled (Shift rows), never what's merely been
 * submitted or approved as availability — see Shift's own doc comment in prisma/schema.prisma.
 * A team member can't edit or delete anything here directly (client spec: "the Team Member must
 * not be able to edit or delete it directly") — phase 2 adds the one path around that: Request
 * Shift Change / Request Cancellation, below. Phase 3 (client spec, Sept 2026): "re-point tasks
 * and messages onto shifts instead of the original availability submission" — each shift's
 * "Tasks" link below points at that date's own group on the My Tasks page (/tasks?date=<date>).
 * Oct 2026 (CB, approving the mockup): this used to expand an inline MyDateTasksPanel right on
 * this card, same component AvailabilityCalendar used for an availability date; both now link out
 * to the real Tasks page instead — see MyTasksView's own doc comment for why (organizing a team
 * member's tasks by date, including past ones, needed a real page, not a per-card panel).
 *
 * Oct 2026, round two (CB: "my schedule needs to read a little better... that page needs to
 * look a lot more aesthetic and organized and clean... remember we're going from a week to week
 * basis"): the old Upcoming/"Past & other" split is replaced with the same week-paginated strip
 * now used on My Tasks and Availability's "Your submissions" (TeamAvailabilityWeekPanel's own
 * pattern, via the shared getWeek/formatWeekRange helpers in src/lib/week.ts) — one week of
 * shifts on screen at a time, oldest first, instead of two buckets that would only grow over
 * time. Each card also gets a left-edge color accent matching its status pill (see the ACCENT
 * map above) so the page reads at a glance instead of as a wall of identical white cards.
 */
export default function ScheduleView() {
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [offset, setOffset] = useState(0);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/shifts");
      if (!res.ok) throw new Error();
      const data: { shifts: ShiftDTO[] } = await res.json();
      setShifts(data.shifts);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  if (loadState === "loading") {
    return (
      <div className="max-w-4xl grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="max-w-4xl rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load your schedule. Please try again or contact HR.
      </div>
    );
  }

  const week = getWeek(offset);
  const weekShifts = [...shifts.filter((s) => s.date >= week.start && s.date <= week.end)].sort((a, b) =>
    a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date < b.date ? -1 : 1
  );

  return (
    <div className="max-w-4xl">
      <h1 className="page-title text-2xl mb-1">My Schedule</h1>
      <p className="text-sm text-muted mb-4">
        Your confirmed shifts — dates a supervisor has actually scheduled you for, not just what
        you&apos;ve submitted as available.
      </p>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 mb-4 w-fit">
        <button
          type="button"
          onClick={() => setOffset((o) => o - 1)}
          className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
          aria-label="Previous week"
        >
          ‹
        </button>
        <span className="text-sm font-semibold min-w-[150px] text-center tabular-nums">
          Week of {formatWeekRange(week.start, week.end)}
        </span>
        {offset === 0 && (
          <span className="text-[11px] font-semibold text-accent-ink bg-accent/10 rounded-full px-2.5 py-0.5">
            This week
          </span>
        )}
        <button
          type="button"
          onClick={() => setOffset((o) => o + 1)}
          className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      {weekShifts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          Nothing scheduled this week.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {weekShifts.map((s) => (
            <ShiftCard key={s.id} shift={s} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

/** "Request Shift Change" / "Request Cancellation" — phase 2 (client spec, Sept 2026): the one
 *  path around "the Team Member must not be able to edit or delete it directly." Only offered on
 *  a shift whose STORED status is UPCOMING (not the derived displayStatus — a shift already
 *  IN_PROGRESS or COMPLETED by the clock is still, underneath, an UPCOMING row eligible for a
 *  request right up until it's actually over; see deriveShiftDisplayStatus's own doc comment). */
function ShiftCard({
  shift,
  onChanged,
}: {
  shift: ShiftDTO;
  onChanged?: () => void;
}) {
  const [mode, setMode] = useState<"none" | "change" | "cancel">("none");
  const [reason, setReason] = useState("");
  const [proposeNewTime, setProposeNewTime] = useState(false);
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedStartTime, setRequestedStartTime] = useState("");
  const [requestedEndTime, setRequestedEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRequest = shift.status === "UPCOMING";
  const hasPendingRequest = shift.status === "CHANGE_REQUESTED" || shift.status === "CANCELLATION_REQUESTED";

  function closeForm() {
    setMode("none");
    setReason("");
    setProposeNewTime(false);
    setRequestedDate("");
    setRequestedStartTime("");
    setRequestedEndTime("");
    setError(null);
  }

  async function submit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const path = mode === "change" ? "request-change" : "request-cancellation";
      const body: Record<string, string> =
        mode === "change" && proposeNewTime
          ? { reason, requestedDate, requestedStartTime, requestedEndTime }
          : { reason };
      const res = await fetch(`/api/shifts/${shift.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send that request.");
      closeForm();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-4 pl-5">
      <span
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: ACCENT[shift.displayStatus] }}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{formatSlotDate(shift.date)}</p>
          <p className="text-sm text-muted">
            {formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}
          </p>
        </div>
        <ShiftStatusPill status={shift.displayStatus} />
      </div>
      {shift.note && <p className="text-sm text-muted italic mt-2">&ldquo;{shift.note}&rdquo;</p>}
      {shift.status === "CANCELLED" && shift.cancelReason && (
        <p className="text-sm text-accent mt-2">Cancelled: {shift.cancelReason}</p>
      )}

      {hasPendingRequest && (
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-sm">
          <p className="text-amber-800">
            {shift.status === "CHANGE_REQUESTED" ? "You requested a change" : "You requested cancellation"}
            {shift.changeReason ? `: "${shift.changeReason}"` : "."}
          </p>
          {shift.requestedDate && shift.requestedStartTime && shift.requestedEndTime && (
            <p className="text-amber-800 mt-1">
              Proposed: {formatSlotDate(shift.requestedDate)}, {formatTime12h(shift.requestedStartTime)} –{" "}
              {formatTime12h(shift.requestedEndTime)}
            </p>
          )}
          <p className="text-amber-700/80 mt-1">Waiting on your supervisor to respond.</p>
        </div>
      )}
      {!hasPendingRequest && shift.reviewComment && (
        <p className="text-sm text-muted italic mt-2">Supervisor&apos;s note: &ldquo;{shift.reviewComment}&rdquo;</p>
      )}

      {canRequest && mode === "none" && (
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={() => setMode("change")}
            className="text-xs font-medium text-accent-ink hover:underline"
          >
            Request change
          </button>
          <button type="button" onClick={() => setMode("cancel")} className="text-xs font-medium text-accent hover:underline">
            Request cancellation
          </button>
        </div>
      )}

      {mode !== "none" && (
        <div className="mt-3 space-y-2.5 bg-black/[0.03] rounded-xl p-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "change" ? "Why do you need this shift changed? (required)" : "Why do you need this shift cancelled? (required)"}
            rows={2}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent-ink"
          />
          {mode === "change" && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={proposeNewTime} onChange={(e) => setProposeNewTime(e.target.checked)} />
                Propose a specific new date/time
              </label>
              {proposeNewTime && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                  <input
                    type="date"
                    value={requestedDate}
                    onChange={(e) => setRequestedDate(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
                  />
                  <input
                    type="time"
                    value={requestedStartTime}
                    onChange={(e) => setRequestedStartTime(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
                  />
                  <input
                    type="time"
                    value={requestedEndTime}
                    onChange={(e) => setRequestedEndTime(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
                  />
                </div>
              )}
            </div>
          )}
          {error && <p className="text-xs text-accent">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={
                submitting || !reason.trim() || (mode === "change" && proposeNewTime && (!requestedDate || !requestedStartTime || !requestedEndTime))
              }
              className="btn-primary text-sm px-3.5 py-1.5"
            >
              Send request
            </button>
            <button type="button" onClick={closeForm} className="text-sm text-muted hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Phase 3 (client spec, Sept 2026): "re-point tasks and messages onto shifts instead of
          the original availability submission" — same tasks AvailabilityCalendar already links to
          for an availability date, now on the shift itself. Oct 2026 (CB, approving the mockup):
          this used to expand an inline task list right on this card; now it's a real link to that
          date's own group on the My Tasks page, same deep-link shape as AnnouncementsSection's
          ?id= and AvailabilityCalendar's own ?date= link just above it in this app. */}
      <Link
        href={`/tasks?date=${shift.date}`}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-accent-ink transition-colors"
      >
        <ChecklistIcon className="h-3.5 w-3.5" />
        Tasks
      </Link>
    </div>
  );
}
