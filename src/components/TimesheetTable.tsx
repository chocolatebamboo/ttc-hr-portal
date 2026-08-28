"use client";

import { useState } from "react";
import StatusPill from "@/components/StatusPill";
import { combineDateAndTime, formatClockTime, formatMinutes, toTimeInputValue } from "@/lib/time";
import type { TimeEntryDTO } from "@/types";

export interface ReviewControls {
  onApprove: (entryId: string) => void;
  onReturn: (entryId: string, comment: string) => void;
  /** The entry currently mid-request, so its own row shows a busy state (not the whole table). */
  busyEntryId: string | null;
}

export interface CorrectionValues {
  clockIn: Date | null;
  lunchStart: Date | null;
  lunchEnd: Date | null;
  clockOut: Date | null;
}

export interface CorrectionControls {
  onSubmit: (entryId: string, values: CorrectionValues) => void;
  busyEntryId: string | null;
  /** Server-reported validation message from the last attempt, e.g. "Clock out must be after clock in." */
  error?: string;
}

/** Every calendar day in the week, filled in from `entries` where an entry exists — a day
 *  with no row is a real "Missing Entry" the employee/HR should notice, not a blank.
 *  Pass `review` for a supervisor/HR review table with Approve/Return actions on rows
 *  Awaiting Approval. Pass `correction` for the employee's own view, which additionally
 *  lets them edit and resubmit a Returned day. Omit both for a plain read-only table. */
export default function TimesheetTable({
  days,
  entries,
  review,
  correction,
}: {
  days: string[]; // ISO date strings, Mon..Sun
  entries: TimeEntryDTO[];
  review?: ReviewControls;
  correction?: CorrectionControls;
}) {
  const byDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const weeklyMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-black/[0.02] text-left text-xs uppercase tracking-wide text-muted/70">
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Clock In</th>
            <th className="px-4 py-2.5 font-medium">Lunch</th>
            <th className="px-4 py-2.5 font-medium">Clock Out</th>
            <th className="px-4 py-2.5 font-medium">Hours</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            {(review || correction) && <th className="px-4 py-2.5 font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {days.map((day) => {
            const entry = byDate.get(day);
            const label = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return (
              <TimesheetRow key={day} day={day} label={label} entry={entry} review={review} correction={correction} />
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-black/[0.02] font-medium">
            <td className="px-4 py-2.5" colSpan={4}>
              Weekly total
            </td>
            <td className="px-4 py-2.5 tabular-nums">{formatMinutes(weeklyMinutes)}</td>
            <td colSpan={review || correction ? 2 : 1} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TimesheetRow({
  day,
  label,
  entry,
  review,
  correction,
}: {
  day: string;
  label: string;
  entry: TimeEntryDTO | undefined;
  review?: ReviewControls;
  correction?: CorrectionControls;
}) {
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [times, setTimes] = useState({ clockIn: "", lunchStart: "", lunchEnd: "", clockOut: "" });

  const colSpan = review || correction ? 7 : 6;
  const isReviewBusy = review?.busyEntryId === entry?.id;
  const isCorrectionBusy = correction?.busyEntryId === entry?.id;
  const isActionable = review && entry?.status === "AWAITING_APPROVAL";
  const isCorrectable = correction && entry?.status === "RETURNED";

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
    if (!entry || !correction) return;
    correction.onSubmit(entry.id, {
      clockIn: combineDateAndTime(day, times.clockIn),
      lunchStart: combineDateAndTime(day, times.lunchStart),
      lunchEnd: combineDateAndTime(day, times.lunchEnd),
      clockOut: combineDateAndTime(day, times.clockOut),
    });
  }

  return (
    <>
      <tr>
        <td className="px-4 py-2.5 whitespace-nowrap">{label}</td>
        <td className="px-4 py-2.5 tabular-nums">{formatClockTime(entry?.clockIn ?? null)}</td>
        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
          {entry?.lunchStart ? `${formatClockTime(entry.lunchStart)} – ${formatClockTime(entry.lunchEnd)}` : "—"}
        </td>
        <td className="px-4 py-2.5 tabular-nums">{formatClockTime(entry?.clockOut ?? null)}</td>
        <td className="px-4 py-2.5 tabular-nums">{formatMinutes(entry?.totalMinutes ?? null)}</td>
        <td className="px-4 py-2.5">
          <StatusPill status={entry?.status ?? "MISSING_ENTRY"} />
        </td>
        {review && (
          <td className="px-4 py-2.5">
            {isActionable ? (
              <div className="flex gap-2">
                <button
                  onClick={() => entry && review.onApprove(entry.id)}
                  disabled={isReviewBusy}
                  className="rounded-md bg-brand text-white text-xs font-medium px-2.5 py-1.5 disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  onClick={() => setReturning((r) => !r)}
                  disabled={isReviewBusy}
                  className="rounded-md border border-border text-xs font-medium px-2.5 py-1.5 disabled:opacity-60"
                >
                  Return
                </button>
              </div>
            ) : (
              <span className="text-xs text-muted">—</span>
            )}
          </td>
        )}
        {correction && (
          <td className="px-4 py-2.5">
            {isCorrectable ? (
              <button
                onClick={() => (editing ? setEditing(false) : startEditing())}
                disabled={isCorrectionBusy}
                className="rounded-md border border-border text-xs font-medium px-2.5 py-1.5 disabled:opacity-60"
              >
                {editing ? "Cancel" : "Edit & resubmit"}
              </button>
            ) : (
              <span className="text-xs text-muted">—</span>
            )}
          </td>
        )}
      </tr>

      {entry?.status === "RETURNED" && entry.reviewComment && (
        <tr>
          <td colSpan={colSpan} className="px-4 pb-2.5 -mt-1">
            <p className="text-xs text-accent">Returned: {entry.reviewComment}</p>
          </td>
        </tr>
      )}

      {returning && entry && (
        <tr>
          <td colSpan={colSpan} className="px-4 pb-3">
            <div className="flex flex-col sm:flex-row gap-2 bg-black/[0.02] rounded-lg p-3">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Explain what needs correcting…"
                rows={2}
                className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand"
              />
              <div className="flex gap-2 sm:flex-col">
                <button
                  onClick={() => {
                    if (!comment.trim()) return;
                    review!.onReturn(entry.id, comment.trim());
                    setReturning(false);
                    setComment("");
                  }}
                  disabled={!comment.trim() || isReviewBusy}
                  className="rounded-md bg-accent text-white text-xs font-medium px-3 py-1.5 disabled:opacity-60"
                >
                  Send back
                </button>
                <button
                  onClick={() => setReturning(false)}
                  className="rounded-md border border-border text-xs font-medium px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {editing && entry && (
        <tr>
          <td colSpan={colSpan} className="px-4 pb-3">
            <div className="bg-black/[0.02] rounded-lg p-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <TimeField label="Clock in" value={times.clockIn} onChange={(v) => setTimes((t) => ({ ...t, clockIn: v }))} />
                <TimeField label="Lunch start" value={times.lunchStart} onChange={(v) => setTimes((t) => ({ ...t, lunchStart: v }))} />
                <TimeField label="Lunch end" value={times.lunchEnd} onChange={(v) => setTimes((t) => ({ ...t, lunchEnd: v }))} />
                <TimeField label="Clock out" value={times.clockOut} onChange={(v) => setTimes((t) => ({ ...t, clockOut: v }))} />
              </div>
              {correction?.error && <p className="text-xs text-accent">{correction.error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={submitCorrection}
                  disabled={isCorrectionBusy}
                  className="rounded-md bg-brand text-white text-xs font-medium px-3 py-1.5 disabled:opacity-60"
                >
                  {isCorrectionBusy ? "Submitting…" : "Resubmit for approval"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md border border-border text-xs font-medium px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
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
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand"
      />
    </label>
  );
}
