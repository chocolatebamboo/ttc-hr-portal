"use client";

import { useEffect, useState } from "react";
import type { CorrectionValues } from "@/components/TimesheetTable";
import StatusPill from "@/components/StatusPill";
import SwipeReveal from "@/components/SwipeReveal";
import TimeOffRequests from "@/components/TimeOffRequests";
import { TrashIcon } from "@/components/icons";
import { combineDateAndTime, formatClockTime, formatMinutes, toTimeInputValue } from "@/lib/time";
import type { TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/** How far back "recent" reaches for the logged-hours summary below — plenty of room for a
 *  Returned entry to still be reachable for correction, without asking the server for a whole
 *  employment history every time this page loads. */
const RECENT_DAYS = 90;

function dateKeyDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TimesheetView({ employeeId }: { employeeId: string }) {
  // CB, Sept 2026: "it should only show the times that we selected... a summary of what we
  // selected" — not a calendar grid (gone already) and not even a fixed week of rows with
  // blank placeholders for days nothing happened. Just the entries that actually exist,
  // most recent first, over a rolling recent window — same "just the real submissions, no
  // empty slots" shape as MyAvailabilityPreview and the time-off list below (now its own
  // TimeOffRequests component, shared with the Availability page).
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | undefined>();
  // Which entry (if any) a delete is currently in flight for — see deleteEntry below.
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  // A failed delete (e.g. the entry got Approved by a supervisor in the moment between this
  // page loading and the tap landing) — kept per-entry so the message shows next to the row
  // it's actually about, same idea as correctionError but scoped tighter since more than one
  // row can now be deletable at once.
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [deleteErrorEntryId, setDeleteErrorEntryId] = useState<string | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const start = dateKeyDaysAgo(RECENT_DAYS);
      const end = dateKeyDaysAgo(0);
      const res = await fetch(`/api/time/timesheet?start=${start}&end=${end}`);
      if (!res.ok) throw new Error("Failed to load timesheet");
      const data = await res.json();
      setEntries(data.entries);
      setLoadState(data.entries.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
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

  // CB, Sept 2026: "I should be able to delete those times... if I swipe... on the respective
  // date block." Then again, once she'd tried it: a whole day should be revertible while it's
  // still Awaiting Approval, not just an accidental zero-minute one — confirmed scope is "true
  // delete[,] awaiting approval only... they wouldn't be able to do that on their side once we
  // approve" (see deleteEmployeeTimeEntry's doc comment on the server for the full rule and the
  // compliance reasoning behind the Approved lock). Removed from `entries` on success so it
  // disappears immediately; since it's a real delete against the one shared TimeEntry table,
  // it's gone from any other view reading the same data too (a supervisor's review page, most
  // notably). A rejection is a real, expected case now (most likely a supervisor approved the
  // same entry a moment earlier) rather than the near-impossible edge case it was when only
  // zero-minute rows qualified, so it's surfaced on the row instead of failing silently.
  async function deleteEntry(entryId: string) {
    setDeletingEntryId(entryId);
    setDeleteError(undefined);
    setDeleteErrorEntryId(null);
    try {
      const res = await fetch(`/api/time/entries/${entryId}`, { method: "DELETE" });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== entryId));
        return;
      }
      const data = await res.json().catch(() => ({}) as { error?: string });
      setDeleteError(data.error ?? "Unable to delete this entry. Please try again.");
      setDeleteErrorEntryId(entryId);
    } catch {
      setDeleteError("Unable to reach the server. Check your connection and try again.");
      setDeleteErrorEntryId(entryId);
    } finally {
      setDeletingEntryId(null);
    }
  }

  return (
    // Wider than a plain reading-width column (CB: the calendar had a huge dead gutter of
    // white space next to it) — the table below fills this width naturally with its own
    // columns, so the page keeps using it rather than sitting in a fixed-width card floating
    // in the middle of the page.
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="page-title text-2xl">My Time</h1>
      </div>

      {/* CB, Sept 2026: My Time is strictly about hours actually worked, corrections, and
          time-off — no availability info here (that lives on the Availability page). */}
      <h2 className="text-sm font-medium text-muted mb-2">Logged hours</h2>

      {loadState === "loading" && (
        <div className="rounded-xl border border-border bg-surface p-6 animate-pulse h-64" />
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your timesheet. Please try again or contact HR.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No hours logged in the last {RECENT_DAYS} days.
        </div>
      )}

      {/* CB, Sept 2026: "it should only show the times that we selected... a summary of what
          we selected" — just the entries that exist, most recent first, same clean card/list
          look as the time-off list below (and MyAvailabilityPreview on the Availability page):
          a rounded card, divide-y rows, a status pill on the right. No placeholder rows for
          days nothing happened, and no bordered spreadsheet-style table. TimesheetTable (the
          plain table) stays as-is for the supervisor's own review view; this is its own
          rendering so that page is unaffected. */}
      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {[...entries].reverse().map((entry) => {
            // Mirrors deleteEmployeeTimeEntry's server-side rule exactly: Approved is locked no
            // matter what, even an old zero-minute mistake — everything else can go if it's
            // still Awaiting Approval, or has no recorded time at all.
            const deletable =
              entry.status !== "APPROVED" && (entry.status === "AWAITING_APPROVAL" || (entry.totalMinutes ?? 0) === 0);
            const row = (
              <TimesheetEntryRow
                entry={entry}
                correction={{ onSubmit: submitCorrection, busyEntryId, error: correctionError }}
                del={{
                  onDelete: deleteEntry,
                  deletable,
                  deleting: deletingEntryId === entry.id,
                  error: deleteErrorEntryId === entry.id ? deleteError : undefined,
                }}
              />
            );
            // See the `deletable` comment above for the exact rule. The row itself now
            // always shows its own trash-icon button when deletable (CB, Sept 2026: "aesthetic
            // almost similar to... the widget where it's... color coded... reads cleanly" — see
            // TimesheetEntryRow); the swipe gesture stays alongside it as a shortcut, same as
            // MyAvailabilityPreview and TimeOffRequests both keep a visible button next to their
            // own swipe action rather than relying on the swipe alone.
            return deletable ? (
              <SwipeReveal
                key={entry.id}
                actionSide="right"
                actionLabel="Delete"
                actionIcon={<TrashIcon className="h-4 w-4" />}
                actionClassName="bg-rose-600 text-white"
                busy={deletingEntryId === entry.id}
                onAction={() => deleteEntry(entry.id)}
              >
                {row}
              </SwipeReveal>
            ) : (
              <div key={entry.id}>{row}</div>
            );
          })}
          <div className="px-4 py-3 flex items-center justify-between bg-black/[0.02] text-sm font-medium">
            <span>Total, last {RECENT_DAYS} days</span>
            <span className="tabular-nums">
              {formatMinutes(entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0))}
            </span>
          </div>
        </div>
      )}

      {/* Time Off, folded in here rather than living on its own page — and now the exact same
          component Availability renders too (CB, Sept 2026: "it needs to be multifunctional"),
          so time off is fully manageable from either page. */}
      <div className="mt-8">
        <TimeOffRequests employeeId={employeeId} />
      </div>
    </div>
  );
}

/** One row of the session-editing form — kept as HH:MM strings from the <input type="time">
 *  elements until submit, same shape TimesheetTable's own row editor uses. */
interface SessionRow {
  clockIn: string;
  clockOut: string;
}

/** One logged day, styled to match the widget/card list look used elsewhere on this page (and
 *  on Availability's own submissions preview) rather than a bordered table row. Only rendered
 *  for a day that actually has an entry — see the "no placeholder rows" comment above this
 *  component's call site. Only a Returned day gets an "Edit & resubmit" control — same rule
 *  TimesheetTable enforces.
 *
 *  `del` renders the small round trash-icon button next to the status pill when this row is
 *  deletable — CB, Sept 2026, on wanting the delete option to actually be visible: "aesthetic
 *  almost similar to... the widget where it has, like, it's color coded... it reads cleanly."
 *  Same button shape MyAvailabilityPreview already uses next to its own status pill, just
 *  tinted for a destructive action (rose, matching the swipe gesture's own color) rather than
 *  the neutral/accent tint used there. */
function TimesheetEntryRow({
  entry,
  correction,
  del,
}: {
  entry: TimeEntryDTO;
  correction: { onSubmit: (entryId: string, sessions: CorrectionValues) => void; busyEntryId: string | null; error?: string };
  del: { onDelete: (entryId: string) => void; deletable: boolean; deleting: boolean; error?: string };
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);

  const day = entry.workDate.slice(0, 10);
  const label = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const isCorrectionBusy = correction.busyEntryId === entry.id;
  const isCorrectable = entry.status === "RETURNED";

  function startEditing() {
    setRows(
      entry.sessions.length > 0
        ? entry.sessions.map((s) => ({ clockIn: toTimeInputValue(s.clockIn), clockOut: toTimeInputValue(s.clockOut) }))
        : [{ clockIn: "", clockOut: "" }]
    );
    setEditing(true);
  }

  function updateRow(index: number, field: keyof SessionRow, value: string) {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function submitCorrection() {
    const sessions = rows
      .map((r) => ({ clockIn: combineDateAndTime(day, r.clockIn), clockOut: combineDateAndTime(day, r.clockOut) }))
      .filter((s): s is { clockIn: Date; clockOut: Date } => s.clockIn !== null && s.clockOut !== null);
    correction.onSubmit(entry.id, sessions);
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          {entry.sessions.length > 0 ? (
            <div className="mt-0.5 space-y-0.5">
              {entry.sessions.map((s) => (
                <p key={s.id} className="text-xs text-muted tabular-nums">
                  {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "in progress"}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted mt-0.5">No sessions recorded</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-medium tabular-nums">{formatMinutes(entry.totalMinutes)}</span>
          <StatusPill status={entry.status} />
          {del.deletable && (
            <button
              type="button"
              onClick={() => del.onDelete(entry.id)}
              disabled={del.deleting}
              aria-label="Delete this entry"
              className="h-6 w-6 flex items-center justify-center rounded-full text-muted hover:text-rose-600 hover:bg-rose-600/10 transition-colors disabled:opacity-50"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {entry.status === "RETURNED" && entry.reviewComment && (
        <p className="text-xs text-accent mt-1.5">Returned: {entry.reviewComment}</p>
      )}

      {del.error && <p className="text-xs text-accent mt-1.5">{del.error}</p>}

      {isCorrectable && (
        <button
          onClick={() => (editing ? setEditing(false) : startEditing())}
          disabled={isCorrectionBusy}
          className="mt-1.5 text-xs font-medium text-accent-ink hover:underline"
        >
          {editing ? "Cancel" : "Edit & resubmit"}
        </button>
      )}

      {editing && (
        <div className="mt-2 bg-black/[0.03] rounded-lg p-3 space-y-3">
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-end gap-2">
                <TimeField label="Clock in" value={row.clockIn} onChange={(v) => updateRow(i, "clockIn", v)} />
                <TimeField label="Clock out" value={row.clockOut} onChange={(v) => updateRow(i, "clockOut", v)} />
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                    aria-label="Remove this session"
                    className="h-8 w-8 shrink-0 rounded-full border border-border bg-surface hover:bg-black/[0.03] text-sm leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((r) => [...r, { clockIn: "", clockOut: "" }])}
              className="text-xs text-accent-ink font-medium hover:underline"
            >
              + Add another session
            </button>
          </div>
          {correction.error && <p className="text-xs text-accent">{correction.error}</p>}
          <div className="flex gap-2">
            <button onClick={submitCorrection} disabled={isCorrectionBusy} className="btn-primary text-xs px-3 py-1.5">
              {isCorrectionBusy ? "Submitting…" : "Resubmit for approval"}
            </button>
            <button onClick={() => setEditing(false)} className="btn-neutral text-xs px-3 py-1.5">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
    </label>
  );
}
