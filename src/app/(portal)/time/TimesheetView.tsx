"use client";

import { useEffect, useState } from "react";
import { getMonth } from "@/lib/month";
import TimesheetCalendar, { type PtoQuickRequestValues } from "@/components/TimesheetCalendar";
import type { CorrectionValues } from "@/components/TimesheetTable";
import type { PtoRequestDTO, TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

export default function TimesheetView() {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | undefined>();

  // PTO requests aren't month-scoped on the server (GET /api/pto/requests returns the whole
  // history, same as the Time Off page) — loaded once on mount and refreshed after any
  // request/cancel, independent of which month is currently displayed.
  const [ptoRequests, setPtoRequests] = useState<PtoRequestDTO[]>([]);
  const [ptoSubmitting, setPtoSubmitting] = useState(false);
  const [ptoCancellingId, setPtoCancellingId] = useState<string | null>(null);
  const [ptoError, setPtoError] = useState<string | undefined>();

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
    try {
      const res = await fetch("/api/pto/requests");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPtoRequests(data.requests);
    } catch {
      // Silent: the calendar still works for time entries without PTO data, and a real
      // outage will already be visible from the timesheet fetch's own error state above.
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

  async function submitCorrection(entryId: string, values: CorrectionValues) {
    setBusyEntryId(entryId);
    setCorrectionError(undefined);
    try {
      const res = await fetch(`/api/time/entries/${entryId}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clockIn: values.clockIn?.toISOString() ?? null,
          lunchStart: values.lunchStart?.toISOString() ?? null,
          lunchEnd: values.lunchEnd?.toISOString() ?? null,
          clockOut: values.clockOut?.toISOString() ?? null,
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

  async function submitQuickPtoRequest(range: { startDate: string; endDate: string }, values: PtoQuickRequestValues) {
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
            onSubmit: submitQuickPtoRequest,
            onCancel: cancelPtoRequest,
            submitting: ptoSubmitting,
            cancellingId: ptoCancellingId,
            error: ptoError,
          }}
        />
      )}
    </div>
  );
}
