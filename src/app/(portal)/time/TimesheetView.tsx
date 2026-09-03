"use client";

import { useEffect, useState } from "react";
import { getMonth } from "@/lib/month";
import TimesheetCalendar, { type PtoQuickRequestValues } from "@/components/TimesheetCalendar";
import type { CorrectionValues } from "@/components/TimesheetTable";
import PtoStatusPill from "@/components/PtoStatusPill";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { PtoRequestDTO, PtoType, TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

const PTO_TYPE_OPTIONS: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];

export default function TimesheetView() {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | undefined>();

  // PTO requests aren't month-scoped on the server (GET /api/pto/requests returns the whole
  // history, same as the old separate Time Off page did) — loaded once on mount and refreshed
  // after any request/cancel, independent of which month the calendar is currently showing.
  // This same state backs both the calendar's day panel AND the "Your requests" list below it,
  // so the two stay in sync without a second fetch.
  const [ptoRequests, setPtoRequests] = useState<PtoRequestDTO[]>([]);
  const [ptoLoadState, setPtoLoadState] = useState<LoadState>("loading");
  const [ptoSubmitting, setPtoSubmitting] = useState(false);
  const [ptoCancellingId, setPtoCancellingId] = useState<string | null>(null);
  const [ptoError, setPtoError] = useState<string | undefined>();
  const [standaloneFormOpen, setStandaloneFormOpen] = useState(false);

  const month = getMonth(offset);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/time/timesheet?start=${month.start}&end=${month.end}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntries(data.entries);
      setLoadState(data.entries.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  async function loadPto() {
    setPtoLoadState("loading");
    try {
      const res = await fetch("/api/pto/requests");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPtoRequests(data.requests);
      setPtoLoadState(data.requests.length === 0 ? "empty" : "ready");
    } catch {
      setPtoLoadState("error");
    }
  }

  useEffect(() => {
    // Fetch-on-mount / on-month-change: this widget has no server-rendered initial state,
    // so it has to ask the API whenever `offset` changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPto();
  }, []);

  async function submitCorrection(entryId: string, sessions: CorrectionValues) {
    setBusyEntryId(entryId);
    setCorrectionError(undefined);
    try {
      const res = await fetch(`/api/time/entries/${entryId}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessions: sessions.map((s) => ({ clockIn: s.clockIn.toISOString(), clockOut: s.clockOut.toISOString() })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCorrectionError(data.error ?? "Unable to submit your correction. Please try again.");
        return;
      }
      await load();
    } catch {
      setCorrectionError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyEntryId(null);
    }
  }

  // Shared by both PTO entry points: the calendar's day panel (a range formed by clicking) and
  // the standalone form below the list (any typed start/end, for a date the calendar isn't
  // currently showing).
  async function submitPtoRequest(range: { startDate: string; endDate: string }, values: PtoQuickRequestValues) {
    setPtoSubmitting(true);
    setPtoError(undefined);
    try {
      const res = await fetch("/api/pto/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: values.type,
          startDate: range.startDate,
          endDate: range.endDate,
          hours: values.hours,
          reason: values.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPtoError(data.error ?? "Unable to submit your request. Please try again.");
        return;
      }
      setStandaloneFormOpen(false);
      await loadPto();
    } catch {
      setPtoError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setPtoSubmitting(false);
    }
  }

  async function cancelPtoRequest(requestId: string) {
    setPtoCancellingId(requestId);
    try {
      await fetch(`/api/pto/requests/${requestId}/cancel`, { method: "POST" });
      await loadPto();
    } finally {
      setPtoCancellingId(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="page-title text-2xl">My Time</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="btn-neutral h-8 w-8 text-sm"
            aria-label="Previous month"
          >
            ←
          </button>
          <span className="text-sm text-muted min-w-[150px] text-center tabular-nums">{month.label}</span>
          <button
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset === 0}
            className="btn-neutral h-8 w-8 text-sm"
            aria-label="Next month"
          >
            →
          </button>
        </div>
      </div>

      {loadState === "loading" && (
        <div className="rounded-xl border border-border bg-surface p-6 animate-pulse h-64" />
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your timesheet. Please try again or contact HR.
        </div>
      )}

      {(loadState === "ready" || loadState === "empty") && (
        <TimesheetCalendar
          month={month}
          entries={entries}
          correction={{ onSubmit: submitCorrection, busyEntryId, error: correctionError }}
          ptoRequests={ptoRequests}
          pto={{
            onSubmit: submitPtoRequest,
            onCancel: cancelPtoRequest,
            submitting: ptoSubmitting,
            cancellingId: ptoCancellingId,
            error: ptoError,
          }}
        />
      )}

      {/* Time Off, folded in here rather than living on its own page — clicking a day above
          covers most requests, but a date outside the month currently showing (or several
          months out) is faster to type than to click through month by month to reach. */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-muted">Your time-off requests</h2>
          <button
            onClick={() => setStandaloneFormOpen((o) => !o)}
            className={standaloneFormOpen ? "btn-neutral text-xs px-3 py-1.5" : "text-xs text-accent-ink font-medium hover:underline"}
          >
            {standaloneFormOpen ? "Cancel" : "Request for another date"}
          </button>
        </div>

        {standaloneFormOpen && (
          <StandalonePtoForm
            onSubmit={submitPtoRequest}
            submitting={ptoSubmitting}
            error={ptoError}
          />
        )}

        {ptoLoadState === "loading" && (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
            ))}
          </div>
        )}

        {ptoLoadState === "error" && (
          <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
            Unable to load your time-off requests. Please try again or contact HR.
          </div>
        )}

        {ptoLoadState === "empty" && !standaloneFormOpen && (
          <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
            You haven&apos;t requested any time off yet.
          </div>
        )}

        {ptoLoadState === "ready" && (
          <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
            {ptoRequests.map((r) => (
              <div key={r.id} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
                    </p>
                    <p className="text-xs text-muted">
                      {r.hours} hours{r.reason ? ` — ${r.reason}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PtoStatusPill status={r.status} />
                    {r.status === "PENDING" && (
                      <button
                        onClick={() => cancelPtoRequest(r.id)}
                        disabled={ptoCancellingId === r.id}
                        className="text-xs text-muted hover:text-accent underline disabled:opacity-50"
                      >
                        {ptoCancellingId === r.id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
                {r.status === "DENIED" && r.reviewComment && (
                  <p className="text-xs text-accent mt-1.5">Denied: {r.reviewComment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StandalonePtoForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (range: { startDate: string; endDate: string }, values: PtoQuickRequestValues) => void;
  submitting: boolean;
  error?: string;
}) {
  const [type, setType] = useState<PtoType>("VACATION");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ startDate, endDate }, { type, hours: Number(hours), reason: reason.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-5 space-y-4 mb-3">
      <div>
        <label className="block text-sm font-medium mb-1.5">Type of leave</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PtoType)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        >
          {PTO_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {PTO_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Start date</label>
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">End date</label>
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Number of hours</label>
        <input
          type="number"
          required
          min="0.5"
          step="0.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="e.g. 8"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Reason / comment (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}

      <button type="submit" disabled={submitting} className="btn-primary px-5 py-2.5 text-sm">
        {submitting ? "Submitting…" : "Submit Request"}
      </button>
    </form>
  );
}
