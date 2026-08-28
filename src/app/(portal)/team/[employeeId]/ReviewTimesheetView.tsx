"use client";

import { useEffect, useState } from "react";
import { getWeek, formatWeekRange } from "@/lib/week";
import TimesheetTable from "@/components/TimesheetTable";
import type { TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

export default function ReviewTimesheetView({ employeeId }: { employeeId: string }) {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  const week = getWeek(offset);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/time/timesheet?employeeId=${employeeId}&start=${week.start}&end=${week.end}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntries(data.entries);
      setLoadState(data.entries.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // Fetch-on-mount / on-week-or-employee-change: this widget has no server-rendered
    // initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, employeeId]);

  async function approve(entryId: string) {
    setBusyEntryId(entryId);
    setActionError("");
    setActionNotice("");
    try {
      const res = await fetch(`/api/time/entries/${entryId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Unable to approve this day. Please try again.");
      } else {
        setActionNotice("Timesheet approved.");
      }
    } catch {
      setActionError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyEntryId(null);
      load();
    }
  }

  async function returnEntry(entryId: string, comment: string) {
    setBusyEntryId(entryId);
    setActionError("");
    setActionNotice("");
    try {
      const res = await fetch(`/api/time/entries/${entryId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Unable to return this day. Please try again.");
      } else {
        setActionNotice("Sent back for correction.");
      }
    } catch {
      setActionError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyEntryId(null);
      load();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
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

      {actionNotice && (
        <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">
          {actionNotice}
        </p>
      )}
      {actionError && (
        <p className="mb-3 text-sm text-accent" role="alert">
          {actionError}
        </p>
      )}

      {loadState === "loading" && (
        <div className="rounded-xl border border-border bg-surface p-6 animate-pulse h-64" />
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load this timesheet. Please try again or contact HR.
        </div>
      )}

      {(loadState === "ready" || loadState === "empty") && (
        <TimesheetTable
          days={week.days}
          entries={entries}
          review={{ onApprove: approve, onReturn: returnEntry, busyEntryId }}
        />
      )}
    </div>
  );
}
