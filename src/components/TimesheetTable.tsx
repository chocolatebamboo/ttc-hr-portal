"use client";

import { useState } from "react";
import StatusPill from "@/components/StatusPill";
import { WarningIcon } from "@/components/icons";
import { formatTime12h } from "@/lib/availability-format";
import { combineDateAndTime, formatClockTime, formatMinutes, todayDateKey, toTimeInputValue } from "@/lib/time";
import type { TimeEntryDTO } from "@/types";

export interface ReviewControls {
  onApprove: (entryId: string) => void;
  onReturn: (entryId: string, comment: string) => void;
  /** The entry currently mid-request, so its own row shows a busy state (not the whole table). */
  busyEntryId: string | null;
  /** Round 10 (CB, Oct 2026, pointing at a flagged double-clock-in recorded as 0h 00m: "we
   *  should have the option to adjust the time and manually edit the time... but remember only
   *  Shawn and I am supposed to be able to have those types of capabilities"). Optional — only
   *  passed by a caller that already knows the current reviewer has canEditFlaggedTimeEntries
   *  (see that field's own doc comment in src/types/index.ts); omitted entirely, nothing about
   *  this table changes for anyone else. When present, an AWAITING_APPROVAL day gets an "Edit
   *  times" action alongside Approve/Return; an already-APPROVED day gets it on its own, since
   *  there's nothing left to Approve/Return there (round 11, CB: a flagged day that had already
   *  been approved as-is still needed fixing) — both reuse the same session-editing form the
   *  employee's own Edit & resubmit already uses. See TimesheetDayCard's isReviewEditable. */
  onEditTimes?: (entryId: string, sessions: CorrectionValues) => void;
  /** Server-reported validation message from the last onEditTimes attempt — same shape as
   *  CorrectionControls.error below. */
  editError?: string;
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

/** Every calendar day in the week, filled in from `entries` where an entry exists. A past or
 *  today day with no entry is real and worth noticing (StatusPill's "Not Logged"); a day later
 *  this week that hasn't happened yet never gets that pill at all — see TimesheetDayCard's own
 *  `isFuture` check below (CB, Oct 2026, pointing at a week showing "Missing Entry" on dates
 *  still days away: "missing entry almost seems like you're saying there's something wrong").
 *  Pass `review` for a supervisor/HR review table with Approve/Return actions on rows
 *  Awaiting Approval. Pass `correction` for the employee's own view, which additionally
 *  lets them edit and resubmit a Returned day. Omit both for a plain read-only table.
 *
 *  Round 3 (CB, Oct 2026, from a screenshot of this exact view with the Actions column cut off
 *  at the phone's edge: "I don't wanna act like scroll on the side just for me to see certain
 *  things I need to read cleanly"): this was a single wide `<table>` that only fit a phone
 *  screen by scrolling sideways, hiding Date on one edge and Actions on the other. It's now a
 *  stack of one card per day — the same four columns' worth of information, just read top to
 *  bottom instead of left to right, with Approve/Return (or Edit & resubmit) living inside each
 *  day's own card instead of a cramped last column. Weekly total moves from a table footer to
 *  its own dark summary bar below the stack, matching the approved mockup.
 *
 *  Round 4 (CB, Oct 2026, pointing at the empty right-hand space on this exact review page at
 *  desktop width, with the dark "Weekly total" bar circled at the bottom of a narrow column):
 *  on the one page wide enough to afford it, that bar is replaced with a sticky sidebar card —
 *  see WeeklyTotalSidebar.tsx, rendered by ReviewTimesheetView.tsx alongside this component.
 *  Pass `hideSummaryBar` there so the two totals don't both show at once; every other caller
 *  (the employee's own My Time page doesn't call this component at all, but anything else that
 *  does) keeps the original bottom bar by default. */
export default function TimesheetTable({
  days,
  entries,
  review,
  correction,
  hideSummaryBar,
}: {
  days: string[]; // ISO date strings, Mon..Sun
  entries: TimeEntryDTO[];
  review?: ReviewControls;
  correction?: CorrectionControls;
  /** Suppress the built-in "Weekly total" bar below the day stack — for a caller that renders
   *  its own weekly total elsewhere (ReviewTimesheetView's desktop sidebar). */
  hideSummaryBar?: boolean;
}) {
  const byDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const weeklyMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);

  return (
    <div className="flex flex-col gap-2">
      {days.map((day) => {
        const entry = byDate.get(day);
        const label = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        return (
          <TimesheetDayCard key={day} day={day} label={label} entry={entry} review={review} correction={correction} />
        );
      })}
      {!hideSummaryBar && (
        <div className="flex items-center justify-between rounded-2xl bg-neutral-900 text-white px-4 py-3 mt-1">
          <span className="text-sm font-semibold">Weekly total</span>
          <span className="tabular-nums text-sm font-bold">{formatMinutes(weeklyMinutes)}</span>
        </div>
      )}
    </div>
  );
}

function TimesheetDayCard({
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

  const isReviewBusy = review?.busyEntryId === entry?.id;
  const isCorrectionBusy = correction?.busyEntryId === entry?.id;
  const isActionable = review && entry?.status === "AWAITING_APPROVAL";
  const isCorrectable = correction && entry?.status === "RETURNED";
  // Round 10 (CB, Oct 2026): the reviewer-side "Edit times" capability — see ReviewControls'
  // own doc comment on onEditTimes.
  //
  // Round 11 (CB, Oct 2026, pointing at Haile's own entry after it had already been left
  // Approved with 0h 00m still on it): originally gated to AWAITING_APPROVAL only, same as
  // isActionable (Approve/Return) just below — but a flagged day can reach APPROVED before
  // anyone notices the flag, and CB still needs to fix it from here once it has. Now offered on
  // either status; RETURNED/IN_PROGRESS/no-entry stay out of scope — RETURNED already has the
  // employee's own Edit & resubmit path, and there's nothing meaningful to correct on a day
  // that's still open or was never logged at all.
  const isReviewEditable =
    !!review?.onEditTimes && (entry?.status === "AWAITING_APPROVAL" || entry?.status === "APPROVED");
  // CB, Oct 2026: a week view always renders all 7 days up front, including days later this
  // same week that haven't happened yet — those showed "Missing Entry" right alongside genuinely
  // overdue past days, which read as a problem on a day nobody could have logged time for yet.
  // Only a day with no entry AND no future date gets the pill below; a future day with no entry
  // instead shows a plain "Upcoming" (see the Status cell).
  const isFuture = !entry && day > todayDateKey();

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

  // Round 10 (CB, Oct 2026): generalized from the employee-only submitCorrection this used to
  // be — same session-row-to-Date-pairs conversion either way, just handed to whichever action
  // is actually present. correction.onSubmit (the employee's own "Resubmit for approval") takes
  // priority when both happen to be passed, since nothing in this app currently passes both at
  // once — this table only ever plays the employee-correction role OR the reviewer-edit role for
  // a given caller, never both.
  function submitSessionEdit() {
    if (!entry) return;
    const sessions = rows
      .map((r) => ({ clockIn: combineDateAndTime(day, r.clockIn), clockOut: combineDateAndTime(day, r.clockOut) }))
      .filter((s): s is { clockIn: Date; clockOut: Date } => s.clockIn !== null && s.clockOut !== null);
    if (correction) {
      correction.onSubmit(entry.id, sessions);
    } else if (review?.onEditTimes) {
      review.onEditTimes(entry.id, sessions);
    }
  }

  return (
    <div
      className={`rounded-2xl border bg-surface p-3.5 ${
        isActionable || isCorrectable ? "border-accent/35" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        {isFuture ? (
          <span className="text-xs text-muted">Upcoming</span>
        ) : (
          <StatusPill status={entry?.status ?? "MISSING_ENTRY"} />
        )}
      </div>

      <div className="flex items-start justify-between gap-3 mt-2">
        <div className="flex-1 min-w-0">
          {entry && entry.sessions.length > 0 ? (
            <div className="space-y-1.5">
              {entry.sessions.map((s) => (
                <div key={s.id}>
                  <div className="tabular-nums text-xs text-foreground">
                    {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "in progress"}
                  </div>
                  {/* CB, Oct 2026, on a flagged/auto-clocked-out day: "we should be able to see
                      the exact time that they were supposed to clock in... what was the actual
                      time frame they were supposed to clock out, even if it automatically clocks
                      them out." Shown whenever this session matched a scheduled shift at
                      clock-in (scheduledStartTime/EndTime come from GET /api/time/timesheet
                      only — see TimeSessionDTO's own doc comment), not just on a flagged row,
                      so a reviewer can always see the schedule right next to the recorded time
                      instead of only being told something didn't match. */}
                  {s.scheduledStartTime && s.scheduledEndTime && (
                    <div className="text-[11px] text-muted">
                      Scheduled {formatTime12h(s.scheduledStartTime)} – {formatTime12h(s.scheduledEndTime)}
                    </div>
                  )}
                  {/* Phase 3 (client spec, Sept 2026): flags a clock-in that had no scheduled
                      shift, or fell outside its 15-minute window — visible here on both the
                      employee's own view and the supervisor/HR review view, since this table
                      serves both. */}
                  {s.isException && (
                    <div className="flex items-start gap-1 text-xs text-amber-700">
                      <WarningIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>Flagged{s.exceptionReason ? `: ${s.exceptionReason}` : ""}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted">—</span>
          )}
        </div>
        <span className="tabular-nums text-sm font-semibold shrink-0">
          {formatMinutes(entry?.totalMinutes ?? null)}
        </span>
      </div>

      {entry?.status === "RETURNED" && entry.reviewComment && (
        <p className="text-xs text-accent mt-2">Returned: {entry.reviewComment}</p>
      )}

      {review && isActionable && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => entry && review.onApprove(entry.id)}
            disabled={isReviewBusy}
            className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center"
          >
            Approve
          </button>
          <button
            onClick={() => setReturning((r) => !r)}
            disabled={isReviewBusy}
            className="btn-neutral text-xs px-3 py-1.5 flex-1 justify-center"
          >
            Return
          </button>
          {/* Round 10 (CB, Oct 2026) — see ReviewControls' onEditTimes doc comment. Only CB and
              Shawn ever have onEditTimes passed in at all, so this button simply doesn't exist
              for anyone else. */}
          {isReviewEditable && (
            <button
              onClick={() => (editing ? setEditing(false) : startEditing())}
              disabled={isReviewBusy}
              className="btn-neutral text-xs px-3 py-1.5 flex-1 justify-center"
            >
              {editing ? "Cancel" : "Edit times"}
            </button>
          )}
        </div>
      )}

      {/* Round 11 (CB, Oct 2026, on Haile's own already-Approved 0h 00m day): Approve/Return
          only ever show on an AWAITING_APPROVAL day (isActionable above) — there's nothing left
          to decide on one that's already Approved. Edit times still needs its own way in here,
          on its own, for exactly that case. */}
      {review && !isActionable && isReviewEditable && (
        <div className="mt-3">
          <button
            onClick={() => (editing ? setEditing(false) : startEditing())}
            disabled={isReviewBusy}
            className="btn-neutral text-xs px-3 py-1.5"
          >
            {editing ? "Cancel" : "Edit times"}
          </button>
        </div>
      )}

      {returning && entry && (
        <div className="flex flex-col gap-2 bg-black/[0.02] rounded-lg p-3 mt-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Explain what needs correcting…"
            rows={2}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!comment.trim()) return;
                review!.onReturn(entry.id, comment.trim());
                setReturning(false);
                setComment("");
              }}
              disabled={!comment.trim() || isReviewBusy}
              className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center"
            >
              Send back
            </button>
            <button
              onClick={() => setReturning(false)}
              className="btn-neutral text-xs px-3 py-1.5 flex-1 justify-center"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {correction && isCorrectable && (
        <div className="mt-3">
          <button
            onClick={() => (editing ? setEditing(false) : startEditing())}
            disabled={isCorrectionBusy}
            className="btn-neutral text-xs px-3 py-1.5"
          >
            {editing ? "Cancel" : "Edit & resubmit"}
          </button>
        </div>
      )}

      {editing && entry && (
        <div className="bg-black/[0.02] rounded-lg p-3 space-y-3 mt-3">
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
          {/* Round 10 (CB, Oct 2026): this form now serves two different actions depending on
              which prop is present — the employee's own Edit & resubmit (correction), or a
              reviewer's Edit times on a flagged day (review.onEditTimes) — see
              submitSessionEdit's own doc comment just above. */}
          {(correction?.error ?? review?.editError) && (
            <p className="text-xs text-accent">{correction?.error ?? review?.editError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={submitSessionEdit}
              disabled={correction ? isCorrectionBusy : isReviewBusy}
              className="btn-primary text-xs px-3 py-1.5"
            >
              {correction
                ? isCorrectionBusy
                  ? "Submitting…"
                  : "Resubmit for approval"
                : isReviewBusy
                  ? "Saving…"
                  : "Save corrected times"}
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
