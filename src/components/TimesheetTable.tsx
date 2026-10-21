"use client";

import { useState, type ReactNode } from "react";
import StatusPill from "@/components/StatusPill";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { WarningIcon, ChevronDownIcon } from "@/components/icons";
import { formatTime12h, formatReviewedAt } from "@/lib/availability-format";
import { combineDateAndTime, formatClockTime, formatMinutes, todayDateKey, toTimeInputValue } from "@/lib/time";
import type { ShiftStatus, TimeEntryDTO } from "@/types";

/** A day's scheduled shift, as carried into this table whenever that day has no TimeEntry yet —
 *  see TimesheetTable's own shiftsByDate doc comment below for the full story. Round sixteen
 *  (CB, Oct 2026, on this same Wed card after round fifteen had already added the pill: "I'm not
 *  seeing like the place where you approve the cancellation and stuff like that. It's like it
 *  just says requested") widens this from just {startTime, endTime, displayStatus} to the shift's
 *  own id plus its request details — approving/declining a request needs the shift's id to call
 *  the API with, and approving a CHANGE_REQUESTED shift needs somewhere to seed the confirm
 *  panel's date/time fields from (changeReason/requestedDate/requestedStartTime/requestedEndTime
 *  — same four fields ShiftDTO itself already carries, see src/types/index.ts). */
export interface ScheduledShiftInfo {
  id: string;
  startTime: string;
  endTime: string;
  displayStatus: ShiftStatus;
  changeReason: string | null;
  requestedDate: string | null;
  requestedStartTime: string | null;
  requestedEndTime: string | null;
}

/** Round sixteen (CB, Oct 2026 — see ScheduledShiftInfo's own doc comment above for the full
 *  quote): lets a reviewer act on a pending CHANGE_REQUESTED/CANCELLATION_REQUESTED shift right
 *  from this table's own card, instead of needing to go to Team Schedule for that. Same three
 *  actions, same API routes, and same outcome (shift status change + notification back to the
 *  employee) as Team Schedule's own Approve cancellation/Approve change/Decline request — see
 *  those handlers in TeamScheduleView.tsx. Optional, same as ReviewControls.onEditTimes below:
 *  omitted entirely by a caller that has no business approving/declining shift requests (e.g. a
 *  plain read-only table), and then a pending request here still shows its ShiftStatusPill, just
 *  with no action buttons under it. */
export interface ShiftRequestControls {
  onApproveCancellation: (shiftId: string) => void;
  onApproveChange: (shiftId: string, date: string, startTime: string, endTime: string) => void;
  onDecline: (shiftId: string, comment: string) => void;
  /** The shift currently mid-request, so only its own card shows a busy state — same idea as
   *  ReviewControls.busyEntryId, just keyed by shift id instead of entry id since the two never
   *  collide but also never line up (an entry-less day only ever has a shift id here, never
   *  both). */
  busyShiftId: string | null;
}

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
   *  employee's own Edit & resubmit already uses. See TimesheetDayCard's isReviewEditable.
   *
   *  Round 13 (CB, Oct 2026, looking at the standing "Edit times" button on Haile's own card:
   *  "I don't want it to seem like this is something serious... just kind of say that we're
   *  adjusting the time"): the capability itself is unchanged, but it no longer sits on the
   *  card as its own always-visible button. It's reached by tapping the time range itself,
   *  which opens a single quiet "Adjust time" option — see the clickable time trigger and
   *  menuOpen state below. Still only ever offered to CB/Shawn, same as before. */
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
  shiftsByDate,
  shiftRequest,
}: {
  days: string[]; // ISO date strings, Mon..Sun
  entries: TimeEntryDTO[];
  review?: ReviewControls;
  correction?: CorrectionControls;
  /** Suppress the built-in "Weekly total" bar below the day stack — for a caller that renders
   *  its own weekly total elsewhere (ReviewTimesheetView's desktop sidebar). */
  hideSummaryBar?: boolean;
  /** Oct 2026 (CB, looking at a week where several days had no entry at all yet: "it needs to
   *  reflect appropriately here" — she wants the scheduled time to show on those days too, not
   *  just on a day that already has a corrected/recorded session — see the "Scheduled ___" line
   *  elsewhere in this file for the existing per-session version of the same idea). Keyed by the
   *  same "YYYY-MM-DD" day string `days` already uses; only ever consulted for a day with NO
   *  TimeEntry (see TimesheetDayCard below) — a day that already has sessions keeps using each
   *  session's own scheduledStartTime/EndTime instead, which can legitimately differ from this if
   *  a shift was changed after the fact. Optional — a caller with no schedule data to offer (or
   *  that doesn't care, e.g. a quick read-only table) just omits it and every day falls back to
   *  today's plain "—"/"Upcoming" treatment, unchanged.
   *
   *  Round fifteen (CB, Oct 2026, on Haile's Wed card showing a plain "Scheduled 3:00 PM – 5:00
   *  PM" with no hint it actually had a cancellation request sitting on it: "I just wanna make
   *  sure that it's in that view"): carries the shift's own displayStatus along with its times so
   *  TimesheetDayCard can flag a pending CHANGE_REQUESTED/CANCELLATION_REQUESTED right here too,
   *  not just on Team Schedule — see the ShiftStatusPill usage below.
   *
   *  Round sixteen widens each entry to the fuller ScheduledShiftInfo shape — see that type's own
   *  doc comment above for why. */
  shiftsByDate?: Map<string, ScheduledShiftInfo>;
  /** Round sixteen — see ShiftRequestControls' own doc comment above. */
  shiftRequest?: ShiftRequestControls;
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
          <TimesheetDayCard
            key={day}
            day={day}
            label={label}
            entry={entry}
            review={review}
            correction={correction}
            scheduledShift={!entry ? shiftsByDate?.get(day) : undefined}
            shiftRequest={shiftRequest}
          />
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
  scheduledShift,
  shiftRequest,
}: {
  day: string;
  label: string;
  entry: TimeEntryDTO | undefined;
  review?: ReviewControls;
  correction?: CorrectionControls;
  /** Already resolved to "only when this day has no entry" by the caller above — see
   *  TimesheetTable's own shiftsByDate doc comment. */
  scheduledShift?: ScheduledShiftInfo;
  /** Round sixteen — see ShiftRequestControls' own doc comment above. */
  shiftRequest?: ShiftRequestControls;
}) {
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);
  // Round 13 (CB, Oct 2026) — whether the quiet "Adjust time" option is showing, toggled by
  // tapping the time range itself (see isReviewEditable's own doc comment on ReviewControls).
  // Only ever meaningful when isReviewEditable is true; otherwise never read.
  const [menuOpen, setMenuOpen] = useState(false);
  // Round sixteen — the two panels Approve change/Decline request can open on a pending shift
  // request, same toggle-a-panel idea as `returning` above but for a shift instead of a time
  // entry (distinct state so the two families of actions never collide on the same card — a day
  // only ever has one or the other in practice, since a day with sessions has no scheduledShift
  // at all, but keeping them separate avoids relying on that). approveDate/Start/EndTime seed
  // from the request's own proposed time when the panel opens — see toggleApprovingChange below.
  const [decliningRequest, setDecliningRequest] = useState(false);
  const [declineRequestComment, setDeclineRequestComment] = useState("");
  const [approvingChange, setApprovingChange] = useState(false);
  const [approveDate, setApproveDate] = useState("");
  const [approveStartTime, setApproveStartTime] = useState("");
  const [approveEndTime, setApproveEndTime] = useState("");

  function toggleApprovingChange() {
    const opening = !approvingChange;
    setApprovingChange(opening);
    if (opening && scheduledShift) {
      setApproveDate(scheduledShift.requestedDate ?? day);
      setApproveStartTime(scheduledShift.requestedStartTime ?? scheduledShift.startTime);
      setApproveEndTime(scheduledShift.requestedEndTime ?? scheduledShift.endTime);
    }
  }

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
    setMenuOpen(false);
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
                  {/* Round 13 (CB, Oct 2026): for CB/Shawn only (isReviewEditable), the time
                      itself is the way in — see ReviewControls.onEditTimes's own doc comment.
                      Nothing changes here for anyone else; the time stays plain text. */}
                  {isReviewEditable ? (
                    <TimeDropdownTrigger menuOpen={menuOpen} onToggle={() => setMenuOpen((o) => !o)}>
                      {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "in progress"}
                    </TimeDropdownTrigger>
                  ) : (
                    <div className="tabular-nums text-xs text-foreground">
                      {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "in progress"}
                    </div>
                  )}
                  {/* CB, Oct 2026, on a flagged/auto-clocked-out day: "we should be able to see
                      the exact time that they were supposed to clock in... what was the actual
                      time frame they were supposed to clock out, even if it automatically clocks
                      them out." Shown whenever this session matched a scheduled shift at
                      clock-in (scheduledStartTime/EndTime come from GET /api/time/timesheet
                      only — see TimeSessionDTO's own doc comment), not just on a flagged row,
                      so a reviewer can always see the schedule right next to the recorded time
                      instead of only being told something didn't match.

                      Round two (CB, Oct 2026, on Donique's flagged Oct 12 day, which had no
                      shift at all to match against: "I should see kind of the original... schedule
                      of based off of what was approved... so we could kind of compare"): a flagged
                      row with nothing to show here used to just go quiet — this adds the same kind
                      of line for that case too, so a reviewer always has a baseline to check the
                      clock-in against, whether that's a real schedule or confirmation there wasn't
                      one. Scoped to flagged rows only (isException) — an ordinary clean clock-in
                      with no shift stays exactly as quiet as before, nothing new to see there.
                      Worded carefully per CB's own correction: clock-in was never gated on an
                      approved shift existing (Phase 3: "clocking in with no shift scheduled at
                      all is still allowed, and is always an exception," confirmed again here —
                      she chose to keep that rather than start blocking clock-ins), so this reads
                      as a plain fact to check against, not as something that shouldn't have been
                      possible — same unstyled treatment as the "Scheduled ___" line above it,
                      never calling special attention to it. */}
                  {s.scheduledStartTime && s.scheduledEndTime ? (
                    <div className="text-[11px] text-muted">
                      Scheduled {formatTime12h(s.scheduledStartTime)} – {formatTime12h(s.scheduledEndTime)}
                    </div>
                  ) : (
                    s.isException && <div className="text-[11px] text-muted">No approved shift to compare against</div>
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
              {/* Round 13 (CB, Oct 2026): the one option this opens — see
                  ReviewControls.onEditTimes's own doc comment above for why it replaced a
                  standing "Edit times" button. */}
              {isReviewEditable && menuOpen && <AdjustTimeMenu onSelect={startEditing} />}
            </div>
          ) : entry && isReviewEditable ? (
            // A flagged day can land here with no real sessions left to show a time on (e.g. a
            // double-clock-in that nets to 0h 00m) — the "Adjust time" entry point still needs
            // somewhere to live, so the empty-state dash itself becomes the trigger.
            <div>
              <TimeDropdownTrigger menuOpen={menuOpen} onToggle={() => setMenuOpen((o) => !o)}>
                —
              </TimeDropdownTrigger>
              {menuOpen && <AdjustTimeMenu onSelect={startEditing} />}
            </div>
          ) : scheduledShift ? (
            // Oct 2026 (CB): same "Scheduled ___" wording as the per-session line above, just for
            // a day that has no entry at all yet — "Not Logged" (past/today) or "Upcoming"
            // (later this week), so there's still something to check against instead of a bare
            // dash. See TimesheetTable's own shiftsByDate doc comment above.
            <div className="flex flex-col items-start gap-1.5 w-full">
              <span className="text-sm text-muted">
                Scheduled {formatTime12h(scheduledShift.startTime)} – {formatTime12h(scheduledShift.endTime)}
              </span>
              {/* Round fifteen (CB, Oct 2026): flags a pending request right on this card too —
                  see shiftsByDate's own doc comment above for why. Only these two statuses ever
                  reach here needing a flag; a plain UPCOMING shift stays exactly as quiet as
                  before. */}
              {(scheduledShift.displayStatus === "CHANGE_REQUESTED" ||
                scheduledShift.displayStatus === "CANCELLATION_REQUESTED") && (
                <>
                  <ShiftStatusPill status={scheduledShift.displayStatus} />
                  {scheduledShift.changeReason && (
                    <p className="text-xs text-muted">
                      {scheduledShift.displayStatus === "CHANGE_REQUESTED" &&
                        scheduledShift.requestedDate &&
                        scheduledShift.requestedStartTime &&
                        scheduledShift.requestedEndTime &&
                        `Requested ${new Date(`${scheduledShift.requestedDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${formatTime12h(scheduledShift.requestedStartTime)} – ${formatTime12h(scheduledShift.requestedEndTime)} — `}
                      &ldquo;{scheduledShift.changeReason}&rdquo;
                    </p>
                  )}
                  {/* Round sixteen (CB, Oct 2026, on this same Wed card: "I'm not seeing like the
                      place where you approve the cancellation and stuff like that. It's like it
                      just says requested"): same two actions, same API routes, as Team Schedule's
                      own Approve/Decline — see ShiftRequestControls' own doc comment above for the
                      full story. Only rendered when a caller actually wired shiftRequest in. */}
                  {shiftRequest && (
                    <>
                      {/* CB, Oct 2026, right after this round first went live: "can we make them
                          into buttons instead of it just being the color... like the app
                          approved and decline stuff" — these were text links (Team Schedule's
                          own treatment for the same two actions); now real buttons, same
                          btn-primary/btn-neutral pairing as the Approve/Return row just below on
                          this very card. */}
                      <div className="flex gap-2 w-full">
                        <button
                          type="button"
                          onClick={() =>
                            scheduledShift.displayStatus === "CANCELLATION_REQUESTED"
                              ? shiftRequest.onApproveCancellation(scheduledShift.id)
                              : toggleApprovingChange()
                          }
                          disabled={shiftRequest.busyShiftId === scheduledShift.id}
                          className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center"
                        >
                          {scheduledShift.displayStatus === "CANCELLATION_REQUESTED"
                            ? "Approve cancellation"
                            : "Approve change"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDecliningRequest((d) => !d);
                            setDeclineRequestComment("");
                          }}
                          disabled={shiftRequest.busyShiftId === scheduledShift.id}
                          className="btn-neutral text-xs px-3 py-1.5 flex-1 justify-center"
                        >
                          Decline request
                        </button>
                      </div>
                      {approvingChange && scheduledShift.displayStatus === "CHANGE_REQUESTED" && (
                        <div className="flex flex-col gap-2 bg-black/[0.02] rounded-lg p-3 w-full">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted">Date</span>
                            <input
                              type="date"
                              value={approveDate}
                              onChange={(e) => setApproveDate(e.target.value)}
                              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                            />
                          </label>
                          <div className="flex items-end gap-2">
                            <TimeField label="Start" value={approveStartTime} onChange={setApproveStartTime} />
                            <TimeField label="End" value={approveEndTime} onChange={setApproveEndTime} />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                shiftRequest.onApproveChange(
                                  scheduledShift.id,
                                  approveDate,
                                  approveStartTime,
                                  approveEndTime
                                );
                                setApprovingChange(false);
                              }}
                              disabled={
                                !approveDate ||
                                !approveStartTime ||
                                !approveEndTime ||
                                shiftRequest.busyShiftId === scheduledShift.id
                              }
                              className="btn-primary text-xs px-3 py-1.5"
                            >
                              {shiftRequest.busyShiftId === scheduledShift.id ? "Saving…" : "Confirm approval"}
                            </button>
                            <button
                              onClick={() => setApprovingChange(false)}
                              className="btn-neutral text-xs px-3 py-1.5"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {decliningRequest && (
                        <div className="flex flex-col gap-2 bg-black/[0.02] rounded-lg p-3 w-full">
                          <textarea
                            value={declineRequestComment}
                            onChange={(e) => setDeclineRequestComment(e.target.value)}
                            placeholder="Optional note back to them…"
                            rows={2}
                            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                shiftRequest.onDecline(scheduledShift.id, declineRequestComment.trim());
                                setDecliningRequest(false);
                                setDeclineRequestComment("");
                              }}
                              disabled={shiftRequest.busyShiftId === scheduledShift.id}
                              className="btn-primary text-xs px-3 py-1.5"
                            >
                              {shiftRequest.busyShiftId === scheduledShift.id ? "Saving…" : "Confirm decline"}
                            </button>
                            <button
                              onClick={() => setDecliningRequest(false)}
                              className="btn-neutral text-xs px-3 py-1.5"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
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

      {/* Round twelve (CB, Oct 2026, pointing at Haile's own entry after CB had already used
          Edit times on it: "I'm still not seeing like who also corrected the time and stuff
          and when they did it... we should still be seeing the flagged [reason]"). Once a
          reviewer corrects a flagged day, the live sessions above are just the corrected times
          — nothing on them says this day used to be flagged, or who fixed it. This surfaces
          both, pulled from the audit trail (see GET /api/time/timesheet's own doc comment on
          entry.correction) — visible to the employee on their own My Time page the same as it
          is to CB/Shawn reviewing it, since it's their own worked day either way. */}
      {entry?.correction && (
        <div className="mt-2 space-y-1">
          {entry.correction.originalFlagReason && (
            <div className="flex items-start gap-1 text-xs text-amber-700">
              <WarningIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Originally flagged: {entry.correction.originalFlagReason}</span>
            </div>
          )}
          <p className="text-xs text-muted">
            Corrected by {entry.correction.reviewerName}
            <span className="block text-[11px] mt-0.5">{formatReviewedAt(entry.correction.correctedAt)}</span>
          </p>
        </div>
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
                  : "Save adjustment"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setMenuOpen(false);
              }}
              className="btn-neutral text-xs px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Round 13 (CB, Oct 2026) — the clickable time display itself, standing in for what used to be
 *  a separate "Edit times" button. Shared by the real session times above and the no-sessions
 *  empty-state dash, so both ways into "Adjust time" look and behave the same. */
function TimeDropdownTrigger({
  menuOpen,
  onToggle,
  children,
}: {
  menuOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`tabular-nums text-xs text-foreground inline-flex items-center gap-1 -mx-1 -my-0.5 rounded px-1 py-0.5 ${
        menuOpen ? "bg-accent/10" : ""
      }`}
    >
      {children}
      <ChevronDownIcon className={`h-3 w-3 text-muted/70 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
    </button>
  );
}

/** Round 13 (CB, Oct 2026) — the one quiet option the time trigger opens. A single-item menu
 *  today, but its own component in case a second option (e.g. "View history") ever joins it. */
function AdjustTimeMenu({ onSelect }: { onSelect: () => void }) {
  return (
    <div className="w-44 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-black/[0.03]"
      >
        Adjust time
      </button>
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
