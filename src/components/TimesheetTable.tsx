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

/** A day's edited session list, as Dates ready to send to the API — see
 *  submitEmployeeCorrection in src/lib/time-actions.ts, which replaces the whole list rather
 *  than diffing field-by-field (sessions can be added or removed, not just retimed). */
export type CorrectionValues = { clockIn: Date; clockOut: Date }[];

export interface CorrectionControls {
  onSubmit: (entryId: string, sessions: CorrectionValues) => void;
  busyEntryId: string | null;
  /** Server-reported validation message from the last attempt, e.g. "Each session's clock out
   *  must be after its clock in." */
  error?: string;
}

/** One row of the session-editing form — kept as HH:MM strings from the <input type="time">
 *  elements until submit, same as the rest of this app's time-editing forms. */
interface SessionRow {
  clockIn: string;
  clockOut: string;
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
            <th className="px-4 py-2.5 font-medium">Sessions</th>
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
            <td className="px-4 py-2.5" colSpan={2}>
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
  const [rows, setRows] = useState<SessionRow[]>([]);

  const colSpan = review || correction ? 5 : 4;
  const isReviewBusy = review?.busyEntryId === entry?.id;
  const isCorrectionBusy = correction?.busyEntryId === entry?.id;
  const isActionable = review && entry?.status === "AWAITING_APPROVAL";
  const isCorrectable = correction && entry?.status === "RETURNED";

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
    if (!entry || !correction) return;
    const sessions = rows
      .map((r) => ({ clockIn: combineDateAndTime(day, r.clockIn), clockOut: combineDateAndTime(day, r.clockOut) }))
      .filter((s): s is { clockIn: Date; clockOut: Date } => s.clockIn !== null && s.clockOut !== null);
    correction.onSubmit(entry.id, sessions);
  }

  return (
    <>
      <tr>
        <td className="px-4 py-2.5 whitespace-nowrap align-top">{label}</td>
        <td className="px-4 py-2.5 align-top">
          {entry && entry.sessions.length > 0 ? (
            <div className="space-y-0.5">
              {entry.sessions.map((s) => (
                <div key={s.id} className="tabular-nums whitespace-nowrap text-xs">
                  {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "in progress"}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-4 py-2.5 tabular-nums align-top">{formatMinutes(entry?.totalMinutes ?? null)}</td>
        <td className="px-4 py-2.5 align-top">
          <StatusPill status={entry?.status ?? "MISSING_ENTRY"} />
        </td>
        {review && (
          <td className="px-4 py-2.5 align-top">
            {isActionable ? (
              <div className="flex flex-col gap-1 items-start">
                <button
                  onClick={() => entry && review.onApprove(entry.id)}
                  disabled={isReviewBusy}
                  className="btn-primary text-xs px-3 py-1 whitespace-nowrap w-full justify-center"
                >
                  Approve
                </button>
                <button
                  onClick={() => setReturning((r) => !r)}
                  disabled={isReviewBusy}
                  className="btn-neutral text-xs px-3 py-1 whitespace-nowrap w-full justify-center"
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
          <td className="px-4 py-2.5 align-top">
            {isCorrectable ? (
              <button
                onClick={() => (editing ? setEditing(false) : startEditing())}
                disabled={isCorrectionBusy}
                className="btn-neutral text-xs px-3 py-1.5"
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
                className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
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
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  Send back
                </button>
                <button
                  onClick={() => setReturning(false)}
                  className="btn-neutral text-xs px-3 py-1.5"
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
              {correction?.error && <p className="text-xs text-accent">{correction.error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={submitCorrection}
                  disabled={isCorrectionBusy}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  {isCorrectionBusy ? "Submitting…" : "Resubmit for approval"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="btn-neutral text-xs px-3 py-1.5"
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
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
    </label>
  );
}
