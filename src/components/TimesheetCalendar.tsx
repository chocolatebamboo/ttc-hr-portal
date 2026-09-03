"use client";

import { useEffect, useState } from "react";
import StatusPill from "@/components/StatusPill";
import type { CorrectionControls } from "@/components/TimesheetTable";
import {
  combineDateAndTime,
  formatClockTime,
  formatHoursCompact,
  formatMinutes,
  toTimeInputValue,
} from "@/lib/time";
import type { Month } from "@/lib/month";
import type { TimeEntryDTO, TimeEntryStatus } from "@/types";

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

function fullDateLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * The employee's own "My Time" page, as a month calendar (CB's ask, modeled on an Airbnb-style
 * host calendar: a number per day, click a day to see/edit the detail) rather than one week's
 * table at a time. Deliberately a NEW component rather than a rework of TimesheetTable — that
 * component is also used by the supervisor/HR review page (src/app/(portal)/team/[employeeId]/
 * ReviewTimesheetView.tsx) with a completely different action set (Approve/Return, not
 * edit-and-resubmit), and this redesign was scoped to My Time only. TimesheetTable is untouched.
 *
 * A bonus this shape gets for free: seven narrow columns fit a phone screen naturally, unlike
 * the weekly table, which PILOT_TESTING.md already flags as intentionally side-scrolling on a
 * narrow phone. This is the first timesheet view in the app that doesn't need that tradeoff.
 */
export default function TimesheetCalendar({
  month,
  entries,
  correction,
}: {
  month: Month;
  entries: TimeEntryDTO[];
  correction: CorrectionControls;
}) {
  const byDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const monthlyMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);

  const [selectedDate, setSelectedDate] = useState<string | null>(() => defaultSelection(month));

  // Re-pick a sensible default selection whenever the displayed month changes (prev/next),
  // rather than carrying over a selected day that isn't even in the new grid.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedDate(defaultSelection(month));
  }, [month]);

  const selectedEntry = selectedDate ? byDate.get(selectedDate) : undefined;

  return (
    <div>
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
              const status: TimeEntryStatus = entry?.status ?? "MISSING_ENTRY";
              const isSelected = day.inMonth && !day.isFuture && day.date === selectedDate;
              const dayNumber = Number(day.date.slice(8, 10));

              if (!day.inMonth) {
                return (
                  <div key={day.date} className="h-14 sm:h-18 rounded-lg flex items-start justify-start p-2">
                    <span className="text-xs text-muted/30 tabular-nums">{dayNumber}</span>
                  </div>
                );
              }

              if (day.isFuture) {
                return (
                  <div
                    key={day.date}
                    className="h-14 sm:h-18 rounded-lg border border-border/50 flex items-start justify-start p-2"
                  >
                    <span className="text-xs text-muted/50 tabular-nums">{dayNumber}</span>
                  </div>
                );
              }

              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => setSelectedDate(day.date)}
                  className={`relative h-14 sm:h-18 rounded-lg border p-2 flex flex-col items-start justify-between text-left transition-colors ${
                    isSelected
                      ? "bg-accent-ink border-accent-ink text-white"
                      : day.isToday
                        ? "border-accent-ink/50 bg-surface hover:bg-black/[0.02]"
                        : "border-border bg-surface hover:bg-black/[0.02]"
                  }`}
                >
                  <span className={`text-xs tabular-nums ${isSelected ? "text-white" : ""}`}>{dayNumber}</span>
                  <span className={`text-xs sm:text-sm font-semibold tabular-nums ${isSelected ? "text-white" : ""}`}>
                    {formatHoursCompact(entry?.totalMinutes ?? null)}
                  </span>
                  <span
                    className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
                      isSelected ? "bg-white" : STATUS_DOT[status]
                    }`}
                  />
                </button>
              );
            })
          )}
        </div>
      </div>

      {selectedDate && (
        <DayDetail
          date={selectedDate}
          entry={selectedEntry}
          correction={correction}
          key={selectedDate /* fresh local edit state per day selected */}
        />
      )}
    </div>
  );
}

function defaultSelection(month: Month): string | null {
  const todayCell = month.weeks.flat().find((d) => d.isToday);
  if (todayCell) return todayCell.date;
  const firstPastDay = month.weeks.flat().find((d) => d.inMonth && !d.isFuture);
  return firstPastDay?.date ?? null;
}

function DayDetail({
  date,
  entry,
  correction,
}: {
  date: string;
  entry: TimeEntryDTO | undefined;
  correction: CorrectionControls;
}) {
  const [editing, setEditing] = useState(false);
  const [times, setTimes] = useState({ clockIn: "", lunchStart: "", lunchEnd: "", clockOut: "" });

  const isBusy = correction.busyEntryId === entry?.id;
  const isCorrectable = entry?.status === "RETURNED";

  function startEditing() {
    setTimes({
      clockIn: toTimeInputValue(entry?.clockIn ?? null),
      lunchStart: toTimeInputValue(entry?.lunchStart ?? null),
      lunchEnd: toTimeInputValue(entry?.lunchEnd ?? null),
      clockOut: toTimeInputValue(entry?.clockOut ?? null),
    });
    setEditing(true);
  }

  function submitCorrection() {
    if (!entry) return;
    correction.onSubmit(entry.id, {
      clockIn: combineDateAndTime(date, times.clockIn),
      lunchStart: combineDateAndTime(date, times.lunchStart),
      lunchEnd: combineDateAndTime(date, times.lunchEnd),
      clockOut: combineDateAndTime(date, times.clockOut),
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium">{fullDateLabel(date)}</p>
        <StatusPill status={entry?.status ?? "MISSING_ENTRY"} />
      </div>

      {!entry ? (
        <p className="text-sm text-muted">No time recorded for this day.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Clock In" value={formatClockTime(entry.clockIn)} />
          <Stat
            label="Lunch"
            value={entry.lunchStart ? `${formatClockTime(entry.lunchStart)} – ${formatClockTime(entry.lunchEnd)}` : "—"}
          />
          <Stat label="Clock Out" value={formatClockTime(entry.clockOut)} />
          <Stat label="Hours" value={formatMinutes(entry.totalMinutes)} />
        </div>
      )}

      {entry?.status === "RETURNED" && entry.reviewComment && (
        <p className="text-sm text-accent mt-3">Returned: {entry.reviewComment}</p>
      )}

      {isCorrectable && !editing && (
        <button onClick={startEditing} disabled={isBusy} className="btn-neutral text-xs px-3 py-1.5 mt-3">
          Edit &amp; resubmit
        </button>
      )}

      {isCorrectable && editing && (
        <div className="mt-3 bg-black/[0.02] rounded-lg p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          {correction.error && <p className="text-xs text-accent">{correction.error}</p>}
          <div className="flex gap-2">
            <button onClick={submitCorrection} disabled={isBusy} className="btn-primary text-xs px-3 py-1.5">
              {isBusy ? "Submitting…" : "Resubmit for approval"}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted/70 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="tabular-nums">{value}</p>
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
