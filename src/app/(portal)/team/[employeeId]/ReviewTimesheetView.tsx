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
  const [bulkBusy, setBulkBusy] = useState(false);
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

  const awaitingCount = entries.filter((e) => e.status === "AWAITING_APPROVAL").length;

  async function approveAllAwaiting() {
    const entryIds = entries.filter((e) => e.status === "AWAITING_APPROVAL").map((e) => e.id);
    if (entryIds.length === 0) return;

    setBulkBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const res = await fetch("/api/time/entries/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, entryIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Unable to approve this week. Please try again.");
      } else {
        setActionNotice(
          `Approved ${data.approvedCount} ${data.approvedCount === 1 ? "day" : "days"}.`
        );
      }
    } catch {
      setActionError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBulkBusy(false);
      load();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="btn-neutral h-8 w-8 text-sm"
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
            className="btn-neutral h-8 w-8 text-sm"
            aria-label="Next week"
          >
            →
          </button>
        </div>

        {awaitingCount > 0 && (
          <button
            onClick={approveAllAwaiting}
            disabled={bulkBusy}
            className="btn-primary text-sm px-4 py-1.5"
          >
            {bulkBusy
              ? "Approving…"
              : `Approve all awaiting (${awaitingCount})`}
          </button>
        )}
      </div>

      {actionNotice && (
        <p className="mb-3 text-sm text-emerald-700" role="status">
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
