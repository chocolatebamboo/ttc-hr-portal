"use client";

import { useEffect, useState } from "react";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import type { ShiftDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

const UPCOMING_STATUSES = new Set(["UPCOMING", "IN_PROGRESS", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"]);

/**
 * "My Schedule" — phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): the
 * confirmed-Shift counterpart to My Availability. Deliberately separate pages/records: this
 * shows only what a supervisor has actually scheduled (Shift rows), never what's merely been
 * submitted or approved as availability — see Shift's own doc comment in prisma/schema.prisma.
 * A team member can't edit or delete anything here directly (client spec: "the Team Member must
 * not be able to edit or delete it directly") — phase 2 adds the one path around that: Request
 * Shift Change / Request Cancellation, below.
 */
export default function ScheduleView() {
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

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
      <div className="max-w-2xl space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="max-w-2xl rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load your schedule. Please try again or contact HR.
      </div>
    );
  }

  const upcoming = shifts.filter((s) => UPCOMING_STATUSES.has(s.displayStatus));
  const past = shifts.filter((s) => !UPCOMING_STATUSES.has(s.displayStatus));

  return (
    <div className="max-w-2xl">
      <h1 className="page-title text-2xl mb-1">My Schedule</h1>
      <p className="text-sm text-muted mb-4">
        Your confirmed shifts — dates a supervisor has actually scheduled you for, not just what
        you&apos;ve submitted as available.
      </p>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            No upcoming shifts yet. Once a supervisor confirms your availability as a shift, it
            shows up here.
          </div>
        ) : (
          <div className="space-y-2.5">
            {upcoming.map((s) => (
              <ShiftCard key={s.id} shift={s} onChanged={load} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
            Past & other ({past.length})
          </h2>
          <div className="space-y-2.5">
            {past.map((s) => (
              <ShiftCard key={s.id} shift={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** "Request Shift Change" / "Request Cancellation" — phase 2 (client spec, Sept 2026): the one
 *  path around "the Team Member must not be able to edit or delete it directly." Only offered on
 *  a shift whose STORED status is UPCOMING (not the derived displayStatus — a shift already
 *  IN_PROGRESS or COMPLETED by the clock is still, underneath, an UPCOMING row eligible for a
 *  request right up until it's actually over; see deriveShiftDisplayStatus's own doc comment). */
function ShiftCard({ shift, onChanged }: { shift: ShiftDTO; onChanged?: () => void }) {
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
    <div className="rounded-2xl border border-border bg-surface p-4">
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
    </div>
  );
}
