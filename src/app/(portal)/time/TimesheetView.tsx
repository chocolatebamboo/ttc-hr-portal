"use client";

import { useEffect, useState } from "react";
import { getWeek, formatWeekRange } from "@/lib/week";
import type { CorrectionValues } from "@/components/TimesheetTable";
import StatusPill from "@/components/StatusPill";
import PtoStatusPill from "@/components/PtoStatusPill";
import TeamNotesThread from "@/components/TeamNotesThread";
import SwipeReveal from "@/components/SwipeReveal";
import { ChatIcon, TrashIcon } from "@/components/icons";
import {
  PTO_TYPE_LABEL,
  combineDateAndTime,
  formatClockTime,
  formatDateRange,
  formatMinutes,
  toTimeInputValue,
} from "@/lib/time";
import type { PtoRequestDTO, PtoType, TeamNoteTopicCountDTO, TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

const PTO_TYPE_OPTIONS: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];

/** Values a PTO request is submitted with (type/hours/optional reason) — the date range comes
 *  separately from wherever the request originated. Previously re-exported from
 *  TimesheetCalendar; defined here now that this page no longer renders that component. */
export type PtoQuickRequestValues = { type: PtoType; hours: number; reason?: string };

export default function TimesheetView({ employeeId }: { employeeId: string }) {
  // CB, Sept 2026: "I don't want to have, like, a calendar there" — My Time is now a plain
  // week-at-a-time table, the same shape as the supervisor's own review view
  // (ReviewTimesheetView, src/app/(portal)/team/[employeeId]/ReviewTimesheetView.tsx) just
  // with `correction` controls in place of `review` ones, rather than the scrolling calendar
  // grid (TimesheetCalendar) it used to be. offset 0 = this week, -1 = last week, etc — no
  // future weeks, same cap ReviewTimesheetView already applies.
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | undefined>();

  const week = getWeek(offset);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/time/timesheet?start=${week.start}&end=${week.end}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  // PTO requests aren't week-scoped on the server (GET /api/pto/requests returns the whole
  // history) — loaded once on mount and refreshed after any request/cancel/delete, independent
  // of which week the table above is currently showing. Submitting one now only happens through
  // the "Request for another date" form below, since there's no calendar day to click anymore.
  const [ptoRequests, setPtoRequests] = useState<PtoRequestDTO[]>([]);
  const [ptoLoadState, setPtoLoadState] = useState<LoadState>("loading");
  const [ptoSubmitting, setPtoSubmitting] = useState(false);
  const [ptoCancellingId, setPtoCancellingId] = useState<string | null>(null);
  // CB, round five, on the dashboard's own Time off list first, now asking for the same thing
  // here: "I should be able to delete these as well" — a Cancelled request can be removed for
  // good (see deletePtoRequest's doc comment in src/lib/pto-actions.ts for why only Cancelled
  // qualifies), same underlying DELETE route TimeOffSection already uses on the dashboard.
  const [ptoDeletingId, setPtoDeletingId] = useState<string | null>(null);
  const [ptoError, setPtoError] = useState<string | undefined>();
  const [standaloneFormOpen, setStandaloneFormOpen] = useState(false);
  // Set while adjusting a denied request — CB, round four: "if they got denied... we should be
  // able to adjust it... to select a different time or date," same parity Availability already
  // has via AvailabilityCalendar's startResubmit. Seeds the standalone form with the denied
  // request's values; submitting always creates a brand-new PENDING request rather than editing
  // the denied one in place, same "never edit history" shape as Availability's resubmit.
  const [resubmitFrom, setResubmitFrom] = useState<PtoRequestDTO | null>(null);
  // Which request's conversation (if any) is expanded below the list — CB, Sept 2026: "I don't
  // see where Sean could see those messages," same per-request conversation admin cards
  // already open (TeamPtoCards' topicType="PTO_REQUEST"), now reachable from the employee's
  // own side too.
  const [openPtoId, setOpenPtoId] = useState<string | null>(null);
  const [ptoMessageCounts, setPtoMessageCounts] = useState<Map<string, number>>(new Map());

  async function loadPtoCounts() {
    try {
      const res = await fetch(`/api/team-notes/${employeeId}/topic-counts`);
      if (!res.ok) return;
      const data: { counts: TeamNoteTopicCountDTO[] } = await res.json();
      const map = new Map<string, number>();
      for (const c of data.counts) {
        if (c.topicType !== "PTO_REQUEST") continue;
        map.set(c.topicId, c.total);
      }
      setPtoMessageCounts(map);
    } catch {
      // best-effort — a missing badge isn't worth failing the list over
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPto();
    loadPtoCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Used only by the standalone "Request for another date" form now — see its own comment.
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
      setResubmitFrom(null);
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

  async function deletePtoRequestRow(requestId: string) {
    setPtoDeletingId(requestId);
    try {
      const res = await fetch(`/api/pto/requests/${requestId}`, { method: "DELETE" });
      if (res.ok) setPtoRequests((prev) => prev.filter((r) => r.id !== requestId));
    } finally {
      setPtoDeletingId(null);
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
          time-off — no availability info here (that lives on the Availability page), and as of
          this round, no calendar grid either. Week navigation instead of the old scroll/month
          list. */}
      <div className="flex items-center gap-2 mb-3">
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
        {offset !== 0 && (
          <button
            onClick={() => setOffset(0)}
            className="text-xs text-accent-ink font-medium hover:underline ml-1"
          >
            This week
          </button>
        )}
      </div>

      {loadState === "loading" && (
        <div className="rounded-xl border border-border bg-surface p-6 animate-pulse h-64" />
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your timesheet. Please try again or contact HR.
        </div>
      )}

      {/* CB, Sept 2026: "this needs to be like the widget aesthetic" — same clean card/list
          look as the time-off list right below (and MyAvailabilityPreview on the Availability
          page): a rounded card, divide-y rows, a status pill on the right — not a bordered
          spreadsheet-style table. TimesheetTable (the plain table) stays as-is for the
          supervisor's own review view; this is its own rendering so that page is unaffected. */}
      {(loadState === "ready" || loadState === "empty") && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {week.days.map((day) => (
            <TimesheetDayRow
              key={day}
              day={day}
              entry={entries.find((e) => e.workDate.slice(0, 10) === day)}
              correction={{ onSubmit: submitCorrection, busyEntryId, error: correctionError }}
            />
          ))}
          <div className="px-4 py-3 flex items-center justify-between bg-black/[0.02] text-sm font-medium">
            <span>Weekly total</span>
            <span className="tabular-nums">
              {formatMinutes(entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0))}
            </span>
          </div>
        </div>
      )}

      {/* Time Off, folded in here rather than living on its own page. PTO is now requested only
          through the form below (no calendar day to click), so it's the one way in, not a
          fallback for dates the calendar wasn't currently showing. */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-muted">Your time-off requests</h2>
          <button
            onClick={() => {
              setResubmitFrom(null);
              setStandaloneFormOpen((o) => !o);
            }}
            className={standaloneFormOpen ? "btn-neutral text-xs px-3 py-1.5" : "text-xs text-accent-ink font-medium hover:underline"}
          >
            {standaloneFormOpen ? "Cancel" : "Request time off"}
          </button>
        </div>

        {standaloneFormOpen && (
          <StandalonePtoForm
            key={resubmitFrom?.id ?? "new"}
            onSubmit={submitPtoRequest}
            submitting={ptoSubmitting}
            error={ptoError}
            initial={
              resubmitFrom
                ? {
                    type: resubmitFrom.type,
                    startDate: resubmitFrom.startDate,
                    endDate: resubmitFrom.endDate,
                    hours: String(resubmitFrom.hours),
                    reason: resubmitFrom.reason ?? "",
                  }
                : undefined
            }
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
            {ptoRequests.map((r) => {
              const msgCount = ptoMessageCounts.get(r.id) ?? 0;
              const open = openPtoId === r.id;
              const rowContent = (
                <div className="px-4 py-3.5 bg-surface">
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
                      {/* CB, round five: "I should be able to delete these as well" — same
                          Cancelled-only rule as the dashboard's TimeOffSection. Text link here
                          (not just the swipe action below) for anyone on a non-touch device. */}
                      {r.status === "CANCELLED" && (
                        <button
                          onClick={() => deletePtoRequestRow(r.id)}
                          disabled={ptoDeletingId === r.id}
                          className="text-xs text-muted hover:text-accent underline disabled:opacity-50"
                        >
                          {ptoDeletingId === r.id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </div>
                  {r.status === "DENIED" && r.reviewComment && (
                    <p className="text-xs text-accent mt-1.5">Denied: {r.reviewComment}</p>
                  )}
                  {r.status === "DENIED" && (
                    <button
                      onClick={() => {
                        setResubmitFrom(r);
                        setStandaloneFormOpen(true);
                      }}
                      className="mt-1.5 text-xs font-medium text-accent-ink hover:underline"
                    >
                      Adjust &amp; resubmit
                    </button>
                  )}

                  {/* CB, Sept 2026: "I send it to Sean, I don't see where Sean could see those
                      messages" — the employee-side half of the same per-request conversation
                      TeamPtoCards opens from the admin side (topicType="PTO_REQUEST"). */}
                  <button
                    type="button"
                    onClick={() => setOpenPtoId(open ? null : r.id)}
                    className={`mt-2 flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 transition-colors ${
                      msgCount > 0
                        ? "bg-accent/10 text-accent-ink hover:bg-accent/20"
                        : "text-muted hover:text-accent-ink hover:bg-black/[0.03]"
                    }`}
                  >
                    <ChatIcon className="h-3.5 w-3.5" />
                    {msgCount > 0 ? `${msgCount} message${msgCount === 1 ? "" : "s"}` : "Message about this request"}
                  </button>

                  {open && (
                    <div className="mt-2">
                      <TeamNotesThread
                        employeeId={employeeId}
                        viewerId={employeeId}
                        topicType="PTO_REQUEST"
                        topicId={r.id}
                        placeholder="Message your supervisor or HR about this request…"
                        onMessagePosted={loadPtoCounts}
                      />
                    </div>
                  )}
                </div>
              );

              // CB, round four: "I should be able to slide to the left... and delete it" — a
              // PENDING request swipes to Cancel (cancelPtoRequest itself enforces that only
              // PENDING can be cancelled). CB, round five, the same swipe now also covers
              // Cancelled rows — "I should be able to delete these as well" — swiping there
              // calls the real DELETE (deletePtoRequestRow) instead, since a Cancelled request
              // has nothing left to "cancel" into. The inline text link above (Cancel/Delete)
              // stays either way, for anyone on a non-touch device.
              if (r.status === "PENDING") {
                return (
                  <SwipeReveal
                    key={r.id}
                    actionSide="right"
                    actionLabel="Cancel"
                    actionIcon={<TrashIcon className="h-4 w-4" />}
                    actionClassName="bg-rose-600 text-white"
                    busy={ptoCancellingId === r.id}
                    onAction={() => cancelPtoRequest(r.id)}
                  >
                    {rowContent}
                  </SwipeReveal>
                );
              }
              if (r.status === "CANCELLED") {
                return (
                  <SwipeReveal
                    key={r.id}
                    actionSide="right"
                    actionLabel="Delete"
                    actionIcon={<TrashIcon className="h-4 w-4" />}
                    actionClassName="bg-rose-600 text-white"
                    busy={ptoDeletingId === r.id}
                    onAction={() => deletePtoRequestRow(r.id)}
                  >
                    {rowContent}
                  </SwipeReveal>
                );
              }
              return <div key={r.id}>{rowContent}</div>;
            })}
          </div>
        )}
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

/** One day, styled to match the widget/card list look used elsewhere on this page (and on
 *  Availability's own submissions preview) rather than a bordered table row. Only a Returned
 *  day gets an "Edit & resubmit" control — same rule TimesheetTable enforces. */
function TimesheetDayRow({
  day,
  entry,
  correction,
}: {
  day: string;
  entry: TimeEntryDTO | undefined;
  correction: { onSubmit: (entryId: string, sessions: CorrectionValues) => void; busyEntryId: string | null; error?: string };
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);

  const label = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const isCorrectionBusy = correction.busyEntryId === entry?.id;
  const isCorrectable = entry?.status === "RETURNED";

  function startEditing() {
    setRows(
      entry && entry.sessions.length > 0
        ? entry.sessions.map((s) => ({ clockIn: toTimeInputValue(s.clockIn), clockOut: toTimeInputValue(s.clockOut) }))
        : [{ clockIn: "", clockOut: "" }]
    );
    setEditing(true);
  }

  function updateRow(index: number, field: keyof SessionRow, value: string) {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function submitCorrection() {
    if (!entry) return;
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
          {entry && entry.sessions.length > 0 ? (
            <div className="mt-0.5 space-y-0.5">
              {entry.sessions.map((s) => (
                <p key={s.id} className="text-xs text-muted tabular-nums">
                  {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "in progress"}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted mt-0.5">No hours logged</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-medium tabular-nums">{formatMinutes(entry?.totalMinutes ?? null)}</span>
          <StatusPill status={entry?.status ?? "MISSING_ENTRY"} />
        </div>
      </div>

      {entry?.status === "RETURNED" && entry.reviewComment && (
        <p className="text-xs text-accent mt-1.5">Returned: {entry.reviewComment}</p>
      )}

      {isCorrectable && (
        <button
          onClick={() => (editing ? setEditing(false) : startEditing())}
          disabled={isCorrectionBusy}
          className="mt-1.5 text-xs font-medium text-accent-ink hover:underline"
        >
          {editing ? "Cancel" : "Edit & resubmit"}
        </button>
      )}

      {editing && entry && (
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

function StandalonePtoForm({
  onSubmit,
  submitting,
  error,
  initial,
}: {
  onSubmit: (range: { startDate: string; endDate: string }, values: PtoQuickRequestValues) => void;
  submitting: boolean;
  error?: string;
  /** Pre-fills the form from a denied request being adjusted & resubmitted — omitted for a
   *  plain "Request time off." */
  initial?: { type: PtoType; startDate: string; endDate: string; hours: string; reason: string };
}) {
  const [type, setType] = useState<PtoType>(initial?.type ?? "VACATION");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [hours, setHours] = useState(initial?.hours ?? "");
  const [reason, setReason] = useState(initial?.reason ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ startDate, endDate }, { type, hours: Number(hours), reason: reason.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-5 space-y-4 mb-3">
      {initial && (
        <p className="text-xs font-medium text-accent-ink -mb-1">
          Adjusting your denied request — submitting sends this as a brand-new request.
        </p>
      )}
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
