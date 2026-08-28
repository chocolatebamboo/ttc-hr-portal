"use client";

import { useEffect, useState } from "react";
import { getWeek, formatWeekRange } from "@/lib/week";
import TimesheetTable from "@/components/TimesheetTable";
import type { TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

export default function TimesheetView() {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const week = getWeek(offset);

  useEffect(() => {
    let cancelled = false;
    // Resets to the loading state whenever `offset` (the selected week) changes, so
    // switching weeks shows a spinner instead of the previous week's table while the new
    // one is in flight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadState("loading");
    fetch(`/api/time/timesheet?start=${week.start}&end=${week.end}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setLoadState(data.entries.length === 0 ? "empty" : "ready");
      })
      .catch(() => !cancelled && setLoadState("error"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">My Time</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-black/[0.03]"
            aria-label="Previous week"
          >
            ←
          </button>
          <span className="text-sm text-muted min-w-[150px] text-center tabular-nums">
            {formatWeekRange(week.start, week.end)}
          </span>
          <button
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset === 0}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-black/[0.03] disabled:opacity-40"
            aria-label="Next week"
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
        <TimesheetTable days={week.days} entries={entries} />
      )}
    </div>
  );
}
