"use client";

import { useEffect, useState } from "react";
import StatusPill from "@/components/StatusPill";
import PtoStatusPill from "@/components/PtoStatusPill";
import type { CorrectionControls } from "@/components/TimesheetTable";
import {
  PTO_TYPE_LABEL,
  PTO_TYPE_SHORT,
  combineDateAndTime,
  formatClockTime,
  formatDateRange,
  formatHoursCompact,
  formatMinutes,
  todayDateKey,
  toTimeInputValue,
} from "@/lib/time";
import type { Month } from "@/lib/month";
import type { PtoRequestDTO, PtoStatus, PtoType, TimeEntryDTO, TimeEntryStatus } from "@/types";

// Small status dot on each day cell — same semantic colors as StatusPill (src/components/
// StatusPill.tsx), just a dot instead of a full pill since there isn't room for pill text in
// a calendar cell. Kept as a separate local mapping rather than exporting StatusPill's
// internals, so this file has zero effect on StatusPill's other callers (the timesheet
// review table, most notably).
const STATUS_DOT: Record<TimeEntryStatus, string> = {
  IN_PROGRESS: "bg-blue-500",
  AWAITING_APPROVAL: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  RETURNED: "bg-rose-500",
  MISSING_ENTRY: "bg-black/15",
};

// Same status colors PtoStatusPill uses, as a solid chip background for the day cell — a
// PTO request replaces the hours readout on that cell entirely, since there's normally no
// separate time entry to show alongside it.
const PTO_CHIP: Record<PtoStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  DENIED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-black/5 text-muted",
};

function fullDateLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function nextDateKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Inclusive day count between two date keys — used to default the hours field on a
 *  multi-day request and to pluralize the sheet's copy. */
function dayCount(start: string, end: string): number {
  let n = 0;
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 400) {
    n++;
    cursor = nextDateKey(cursor);
    guard++;
  }
  return n;
}

/** Every calendar day a still-active (non-Cancelled) PTO request covers, keyed by date. When
 *  requests overlap the same day (e.g. a Denied one and a later Pending resubmission), the
 *  most recently created one wins — `requests` is expected pre-sorted newest-first, which is
 *  exactly what GET /api/pto/requests already returns, so the first request seen for a date
 *  is kept and later (older) ones are skipped. */
function ptoByDate(requests: PtoRequestDTO[]): Map<string, PtoRequestDTO> {
  const map = new Map<string, PtoRequestDTO>();
  for (const r of requests) {
    if (r.status === "CANCELLED") continue;
    const end = r.endDate.slice(0, 10);
    let cursor = r.startDate.slice(0, 10);
    let guard = 0; // safety cap — a bad/huge date range should never hang the render
    while (cursor <= end && guard < 400) {
      if (!map.has(cursor)) map.set(cursor, r);
      cursor = nextDateKey(cursor);
      guard++;
    }
  }
  return map;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export interface PtoQuickRequestValues {
  type: PtoType;
  hours: number;
  reason?: string;
}

export interface PtoDayControls {
  /** POST a new PTO request covering [startDate, endDate] (a single day when they're equal). */
  onSubmit: (range: { startDate: string; endDate: string }, values: PtoQuickRequestValues) => void;
  /** Cancel a still-Pending request by id — same rule as the Time Off page: only Pending
   *  requests can be cancelled. */
  onCancel: (requestId: string) => void;
  submitting: boolean;
  /** The request currently being cancelled, so only its own button shows a busy state. */
  cancellingId: string | null;
  error?: string;
}

interface Selection {
  start: string;
  end: string; // === start for a single day
}

/**
 * The employee's own "My Time" page, as a month calendar (CB's ask, modeled on the Airbnb
 * host calendar: a number per day, click a day to see/edit the detail) rather than one week's
 * table at a time. Deliberately a NEW component rather than a rework of TimesheetTable — that
 * component is also used by the supervisor/HR review page (src/app/(portal)/team/[employeeId]/
 * ReviewTimesheetView.tsx) with a completely different action set (Approve/Return, not
 * edit-and-resubmit), and this redesign was scoped to My Time only. TimesheetTable is untouched.
 *
 * Also folds in requesting PTO directly from the calendar. After CB watched an actual
 * screen recording of the Airbnb host calendar, two things about the *first* version of this
 * were wrong relative to that reference and got fixed here:
 *   1. The day panel was a centered/bottom overlay with a dark backdrop that blocked the
 *      calendar underneath it. Airbnb's panel is non-blocking — it docks to the side (bottom
 *      on a phone) and the calendar grid stays fully visible and clickable while it's open.
 *      There is deliberately no backdrop element here for that reason.
 *   2. Airbnb lets you click a second date to extend the first into a multi-day range (the
 *      panel then edits all of it at once) rather than one day at a time. `selection` below
 *      is `{start, end}` rather than a single date for exactly this — clicking a second empty,
 *      future day next to an already-selected one forms a range; the PTO request form then
 *      covers the whole range in one submit, using the exact same startDate/endDate/hours
 *      shape the Time Off page's own multi-day form already sends.
 */
export default function TimesheetCalendar({
  month,
  entries,
  correction,
  ptoRequests,
  pto,
}: {
  month: Month;
  entries: TimeEntryDTO[];
  correction: CorrectionControls;
  ptoRequests: PtoRequestDTO[];
  pto: PtoDayControls;
}) {
  const byDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const ptoMap = ptoByDate(ptoRequests);
  const monthlyMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);

  // A day is "eligible" when there's nothing to show for it yet and it's still ahead of us —
  // exactly the condition under which "Request time off" makes sense. Only eligible days can
  // be chained into a multi-day range; clicking any other kind of day always resets the
  // selection to that single day instead.
  function isEligible(dateKey: string): boolean {
    return !byDate.has(dateKey) && !ptoMap.has(dateKey) && dateKey > todayDateKey();
  }

  function runIsEligible(lo: string, hi: string): boolean {
    let cursor = lo;
    let guard = 0;
    while (cursor <= hi && guard < 400) {
      if (!isEligible(cursor)) return false;
      cursor = nextDateKey(cursor);
      guard++;
    }
    return true;
  }

  // Closed by default — opens as a side panel (bottom sheet on a phone) when a day is
  // clicked, rather than always showing some day's detail. Also closes on prev/next month
  // rather than trying to carry a selection into a grid that no longer has those cells.
  const [selection, setSelection] = useState<Selection | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection(null);
  }, [month]);

  function handleDayClick(dateKey: string) {
    if (
      isEligible(dateKey) &&
      selection &&
      selection.start === selection.end &&
      selection.start !== dateKey &&
      isEligible(selection.start)
    ) {
      const [lo, hi] = selection.start < dateKey ? [selection.start, dateKey] : [dateKey, selection.start];
      if (runIsEligible(lo, hi)) {
        setSelection({ start: lo, end: hi });
        return;
      }
    }
    setSelection({ start: dateKey, end: dateKey });
  }

  const isRange = selection ? selection.start !== selection.end : false;
  const singleEntry = selection && !isRange ? byDate.get(selection.start) : undefined;
  const singlePto = selection && !isRange ? ptoMap.get(selection.start) : undefined;

  return (
    // Room for the side panel on larger screens so it doesn't sit on top of the calendar —
    // Airbnb's own page reflows the same way rather than covering the grid.
    <div className={selection ? "sm:pr-[380px] transition-[padding] duration-200" : ""}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted">
          {monthlyMinutes > 0 ? `${formatMinutes(monthlyMinutes)} logged this month` : "Nothing logged yet this month"}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3 sm:p-4">
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} className="text-center text-xs font-medium text-muted/70 py-1">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {month.weeks.flatMap((week) =>
            week.map((day) => {
              const entry = byDate.get(day.date);
              const dayPto = ptoMap.get(day.date);
              const status: TimeEntryStatus = entry?.status ?? "MISSING_ENTRY";
              const isSelected = day.inMonth && !!selection && day.date >= selection.start && day.date <= selection.end;
              const dayNumber = Number(day.date.slice(8, 10));

              if (!day.inMonth) {
                return (
                  <div key={day.date} className="h-14 sm:h-18 rounded-lg flex items-start justify-start p-2">
                    <span className="text-xs text-muted/30 tabular-nums">{dayNumber}</span>
                  </div>
                );
              }

              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => handleDayClick(day.date)}
                  className={`relative h-14 sm:h-18 rounded-lg border p-2 flex flex-col items-start justify-between text-left transition-colors ${
                    isSelected
                      ? "bg-accent-ink border-accent-ink text-white"
                      : day.isToday
                        ? "border-accent-ink/50 bg-surface hover:bg-black/[0.02]"
                        : "border-border bg-surface hover:bg-black/[0.02]"
                  }`}
                >
                  <span
                    className={`text-xs tabular-nums ${isSelected ? "text-white" : day.isFuture && !dayPto ? "text-muted/60" : ""}`}
                  >
                    {dayNumber}
                  </span>

                  {dayPto ? (
                    <span
                      className={`text-[10px] sm:text-xs font-semibold rounded px-1 py-0.5 ${
                        isSelected ? "bg-white/20 text-white" : PTO_CHIP[dayPto.status]
                      }`}
                    >
                      {PTO_TYPE_SHORT[dayPto.type]}
                    </span>
                  ) : (
                    <span className={`text-xs sm:text-sm font-semibold tabular-nums ${isSelected ? "text-white" : ""}`}>
                      {formatHoursCompact(entry?.totalMinutes ?? null)}
                    </span>
                  )}

                  {!dayPto && (
                    <span
                      className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
                        isSelected ? "bg-white" : STATUS_DOT[status]
                      }`}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {selection && (
        // key resets TimeEntryDetail/RequestTimeOffForm's local edit state whenever the
        // selection itself changes (a different day, or a day added to/removed from a range).
        <DayPanel
          key={`${selection.start}_${selection.end}`}
          selection={selection}
          entry={singleEntry}
          pto={singlePto}
          correction={correction}
          ptoControls={pto}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function DayPanel({
  selection,
  entry,
  pto,
  correction,
  ptoControls,
  onClose,
}: {
  selection: Selection;
  entry: TimeEntryDTO | undefined;
  pto: PtoRequestDTO | undefined;
  correction: CorrectionControls;
  ptoControls: PtoDayControls;
  onClose: () => void;
}) {
  // Close on Escape, same as the X — there's deliberately no backdrop to tap, since the whole
  // point (matching Airbnb) is that the calendar underneath stays visible and clickable while
  // this is open, so clicking another day changes the selection instead of being swallowed by
  // a backdrop.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isRange = selection.start !== selection.end;
  const canRequest = !entry && !pto && (isRange || selection.start > todayDateKey());
  const headerLabel = isRange
    ? `${formatDateRange(selection.start, selection.end)} · ${dayCount(selection.start, selection.end)} days`
    : fullDateLabel(selection.start);

  return (
    <div
      className="fixed z-50 bg-neutral-900 text-white shadow-2xl overflow-y-auto p-5
        inset-x-0 bottom-0 max-h-[75vh] rounded-t-2xl
        sm:inset-y-0 sm:right-0 sm:left-auto sm:bottom-auto sm:w-[380px] sm:max-h-none sm:rounded-none sm:rounded-l-2xl"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-base font-medium">{headerLabel}</p>
        <button
          onClick={onClose}
          aria-label="Close"
          className="h-8 w-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-lg leading-none shrink-0"
        >
          ×
        </button>
      </div>

      {pto ? (
        <PtoDetail pto={pto} entry={entry} controls={ptoControls} />
      ) : entry ? (
        <TimeEntryDetail entry={entry} correction={correction} />
      ) : canRequest ? (
        <RequestTimeOffForm startDate={selection.start} endDate={selection.end} controls={ptoControls} />
      ) : (
        <p className="text-sm text-white/60">No time recorded for this day.</p>
      )}
    </div>
  );
}

function PtoDetail({
  pto,
  entry,
  controls,
}: {
  pto: PtoRequestDTO;
  entry: TimeEntryDTO | undefined;
  controls: PtoDayControls;
}) {
  const isCancelling = controls.cancellingId === pto.id;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-medium">{PTO_TYPE_LABEL[pto.type]}</p>
          <PtoStatusPill status={pto.status} />
        </div>
        <p className="text-sm text-white/70">{formatDateRange(pto.startDate, pto.endDate)}</p>
        <p className="text-sm text-white/70">{pto.hours} hours</p>
        {pto.reason && <p className="text-sm text-white/70 mt-2">&ldquo;{pto.reason}&rdquo;</p>}
        {pto.status === "DENIED" && pto.reviewComment && (
          <p className="text-sm text-rose-300 mt-2">Denied: {pto.reviewComment}</p>
        )}
      </div>

      {pto.status === "PENDING" && (
        <button
          onClick={() => controls.onCancel(pto.id)}
          disabled={isCancelling}
          className="w-full rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 py-2.5 text-sm font-medium"
        >
          {isCancelling ? "Cancelling…" : "Cancel request"}
        </button>
      )}

      {entry && (
        <div className="rounded-xl bg-white/5 p-4">
          <p className="text-xs text-white/50 uppercase tracking-wide mb-2">Time also logged this day</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Clock In" value={formatClockTime(entry.clockIn)} />
            <Stat label="Clock Out" value={formatClockTime(entry.clockOut)} />
            <Stat label="Hours" value={formatMinutes(entry.totalMinutes)} />
            <Stat label="Status" value={<StatusPill status={entry.status} />} />
          </div>
        </div>
      )}
    </div>
  );
}

function TimeEntryDetail({ entry, correction }: { entry: TimeEntryDTO; correction: CorrectionControls }) {
  const [editing, setEditing] = useState(false);
  const [times, setTimes] = useState({ clockIn: "", lunchStart: "", lunchEnd: "", clockOut: "" });

  const isBusy = correction.busyEntryId === entry.id;
  const isCorrectable = entry.status === "RETURNED";
  const dateKey = entry.workDate.slice(0, 10);

  function startEditing() {
    setTimes({
      clockIn: toTimeInputValue(entry.clockIn),
      lunchStart: toTimeInputValue(entry.lunchStart),
      lunchEnd: toTimeInputValue(entry.lunchEnd),
      clockOut: toTimeInputValue(entry.clockOut),
    });
    setEditing(true);
  }

  function submitCorrection() {
    correction.onSubmit(entry.id, {
      clockIn: combineDateAndTime(dateKey, times.clockIn),
      lunchStart: combineDateAndTime(dateKey, times.lunchStart),
      lunchEnd: combineDateAndTime(dateKey, times.lunchEnd),
      clockOut: combineDateAndTime(dateKey, times.clockOut),
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <StatusPill status={entry.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Clock In" value={formatClockTime(entry.clockIn)} />
        <Stat
          label="Lunch"
          value={entry.lunchStart ? `${formatClockTime(entry.lunchStart)} – ${formatClockTime(entry.lunchEnd)}` : "—"}
        />
        <Stat label="Clock Out" value={formatClockTime(entry.clockOut)} />
        <Stat label="Hours" value={formatMinutes(entry.totalMinutes)} />
      </div>

      {entry.status === "RETURNED" && entry.reviewComment && (
        <p className="text-sm text-rose-300 mt-3">Returned: {entry.reviewComment}</p>
      )}

      {isCorrectable && !editing && (
        <button
          onClick={startEditing}
          disabled={isBusy}
          className="rounded-lg bg-white/10 hover:bg-white/20 text-xs px-3 py-1.5 mt-3"
        >
          Edit &amp; resubmit
        </button>
      )}

      {isCorrectable && editing && (
        <div className="mt-3 bg-white/5 rounded-lg p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="Clock in" value={times.clockIn} onChange={(v) => setTimes((t) => ({ ...t, clockIn: v }))} />
            <TimeField
              label="Lunch start"
              value={times.lunchStart}
              onChange={(v) => setTimes((t) => ({ ...t, lunchStart: v }))}
            />
            <TimeField
              label="Lunch end"
              value={times.lunchEnd}
              onChange={(v) => setTimes((t) => ({ ...t, lunchEnd: v }))}
            />
            <TimeField
              label="Clock out"
              value={times.clockOut}
              onChange={(v) => setTimes((t) => ({ ...t, clockOut: v }))}
            />
          </div>
          {correction.error && <p className="text-xs text-rose-300">{correction.error}</p>}
          <div className="flex gap-2">
            <button
              onClick={submitCorrection}
              disabled={isBusy}
              className="rounded-lg bg-white text-neutral-900 hover:bg-white/90 disabled:opacity-50 text-xs px-3 py-1.5 font-medium"
            >
              {isBusy ? "Submitting…" : "Resubmit for approval"}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg bg-white/10 hover:bg-white/20 text-xs px-3 py-1.5">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const TYPE_OPTIONS: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];

function RequestTimeOffForm({
  startDate,
  endDate,
  controls,
}: {
  startDate: string;
  endDate: string;
  controls: PtoDayControls;
}) {
  const n = dayCount(startDate, endDate);
  const [type, setType] = useState<PtoType>("VACATION");
  const [hours, setHours] = useState(String(8 * n));
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    controls.onSubmit({ startDate, endDate }, { type, hours: Number(hours), reason: reason.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-white/60">
        Nothing logged for {n === 1 ? "this day" : `these ${n} days`} yet. Request{" "}
        {n === 1 ? "it" : "them"} off instead?
      </p>

      <div>
        <label className="block text-xs text-white/60 mb-1.5">Type of leave</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PtoType)}
          className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-white/30"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t} className="text-neutral-900">
              {PTO_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-white/60 mb-1.5">Number of hours{n > 1 ? " (total)" : ""}</label>
        <input
          type="number"
          required
          min="0.5"
          step="0.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-white/30"
        />
      </div>

      <div>
        <label className="block text-xs text-white/60 mb-1.5">Reason / comment (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-white/30"
        />
      </div>

      {controls.error && <p className="text-xs text-rose-300">{controls.error}</p>}

      <button
        type="submit"
        disabled={controls.submitting}
        className="w-full rounded-lg bg-white text-neutral-900 hover:bg-white/90 disabled:opacity-50 py-2.5 text-sm font-medium"
      >
        {controls.submitting ? "Submitting…" : "Request time off"}
      </button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-white/50 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="tabular-nums">{value}</p>
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-white/60">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md bg-white/10 border border-white/10 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-white/30"
      />
    </label>
  );
}
