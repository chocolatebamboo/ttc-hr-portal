"use client";

import { useEffect, useState } from "react";
import { getWeek, formatWeekRange, weekOffsetForDate } from "@/lib/week";
import { todayDateKey } from "@/lib/time";
import TimesheetTable, { type CorrectionValues } from "@/components/TimesheetTable";
import WeeklyTotalSidebar, { type WeekBucket } from "@/components/WeeklyTotalSidebar";
import type { TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

export default function ReviewTimesheetView({
  employeeId,
  canEditFlaggedTimeEntries = false,
}: {
  employeeId: string;
  /** Round 10 (CB, Oct 2026): "only Shawn and I am supposed to be able to have those types of
   *  capabilities" — the viewing reviewer's own canEditFlaggedTimeEntries flag (see that field's
   *  doc comment in src/types/index.ts), threaded down from page.tsx. Gates whether editTimes is
   *  even wired into TimesheetTable's review prop at all, not just whether a button happens to
   *  render — someone without the flag never gets review.onEditTimes passed in the first place. */
  canEditFlaggedTimeEntries?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [editTimesError, setEditTimesError] = useState("");

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

  // Oct 2026: picks up ?week=<date> from the Reports page's unapproved-entries banner (CB:
  // "there should be a way that we could kind of view those entries... so we could go back
  // there") and lands this widget on the week that date actually falls in, instead of always
  // defaulting to "this week" — same window.location.search read + clear-after-read pattern
  // TeamScheduleView's own ?dateFrom= deep link already uses, for the same Suspense-boundary
  // reason. Clamped to 0 (never into the future) since a crafted/odd date shouldn't push this
  // past what the "Next week" button itself allows.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const week = params.get("week");
    if (!week) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(Math.min(0, weekOffsetForDate(week)));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

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

  // Round 10 (CB, Oct 2026, pointing at a flagged double-clock-in recorded as 0h 00m: "we
  // should have the option to adjust the time and manually edit the time... but remember only
  // Shawn and I am supposed to be able to have those types of capabilities"). Same
  // busyEntryId/setActionError/setActionNotice/load() shape as approve/returnEntry above, plus
  // its own editTimesError since this is a validation message about the SESSION TIMES
  // themselves (e.g. "clock out must be after clock in"), not a generic action failure — kept
  // separate so it reads back into TimesheetTable's own editing form via review.editError
  // rather than the banner actionError above uses.
  async function editTimes(entryId: string, sessions: CorrectionValues) {
    setBusyEntryId(entryId);
    setEditTimesError("");
    setActionNotice("");
    try {
      const res = await fetch(`/api/time/entries/${entryId}/hr-correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditTimesError(data.error ?? "Unable to save these times. Please try again.");
      } else {
        setActionNotice("Times corrected and approved.");
      }
    } catch {
      setEditTimesError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyEntryId(null);
      load();
    }
  }

  const awaitingCount = entries.filter((e) => e.status === "AWAITING_APPROVAL").length;

  // Round 4 (CB, Oct 2026): the day-by-day breakdown shown in the desktop sidebar — see
  // WeeklyTotalSidebar.tsx. Same byDate/weeklyMinutes logic TimesheetTable computes internally
  // for its own (now hidden on this page) bottom bar, plus a per-status day count. A day later
  // this week with no entry yet is "Upcoming," same as TimesheetTable's own isFuture check — it
  // isn't counted as "Not logged" here either, for the same reason.
  const entryByDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const weeklyMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);
  const weekCounts: Partial<Record<WeekBucket, number>> = {};
  const today = todayDateKey();
  for (const day of week.days) {
    const entry = entryByDate.get(day);
    let bucket: WeekBucket | null = null;
    if (entry?.status === "APPROVED") bucket = "approved";
    else if (entry?.status === "AWAITING_APPROVAL") bucket = "awaiting";
    else if (entry?.status === "RETURNED") bucket = "returned";
    else if (entry?.status === "IN_PROGRESS") bucket = "inProgress";
    else if (!entry && day <= today) bucket = "notLogged";
    if (bucket) weekCounts[bucket] = (weekCounts[bucket] ?? 0) + 1;
  }

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
        // Round 4 (CB, Oct 2026): on desktop this splits into the day list plus a sticky
        // "Weekly total" sidebar using the right-hand space that used to sit empty (the page's
        // own max-w was widened for this — see page.tsx); below `lg` it stays a single column,
        // same as before, with the sidebar's summary card simply falling below the day list.
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
          <TimesheetTable
            days={week.days}
            entries={entries}
            review={{
              onApprove: approve,
              onReturn: returnEntry,
              busyEntryId,
              ...(canEditFlaggedTimeEntries ? { onEditTimes: editTimes, editError: editTimesError } : {}),
            }}
            hideSummaryBar
          />
          <WeeklyTotalSidebar
            weekLabel={formatWeekRange(week.start, week.end)}
            totalMinutes={weeklyMinutes}
            counts={weekCounts}
          />
        </div>
      )}
    </div>
  );
}
