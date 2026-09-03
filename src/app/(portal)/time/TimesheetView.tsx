"use client";

import { useEffect, useState } from "react";
import { getMonth } from "@/lib/month";
import TimesheetCalendar from "@/components/TimesheetCalendar";
import type { CorrectionValues } from "@/components/TimesheetTable";
import type { TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

export default function TimesheetView() {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | undefined>();

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

  useEffect(() => {
    // Fetch-on-mount / on-month-change: this widget has no server-rendered initial state,
    // so it has to ask the API whenever `offset` changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

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
        />
      )}
    </div>
  );
}
