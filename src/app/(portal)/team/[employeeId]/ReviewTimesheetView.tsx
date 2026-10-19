"use client";

import { useEffect, useState } from "react";
import {
  formatWeekRange,
  getCurrentPayrollPeriodOffset,
  getPayrollPeriodWeeks,
  payrollPeriodOffsetForDate,
} from "@/lib/week";
import { formatMinutes, todayDateKey } from "@/lib/time";
import { ChevronDownIcon } from "@/components/icons";
import PayrollPeriodSwitcher from "@/components/PayrollPeriodSwitcher";
import TimesheetTable, { type CorrectionValues, type ReviewControls } from "@/components/TimesheetTable";
import WeeklyTotalSidebar, { type WeekBucket } from "@/components/WeeklyTotalSidebar";
import type { TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/** Which of a pay period's two weeks should start open — the week containing `targetDate`
 *  (today, normally; a specific deep-linked date on first load — see the mount effect below),
 *  falling back to Week 1 when `targetDate` falls in neither (viewing a period that doesn't
 *  contain it at all). Both weeks can still be opened or closed independently afterward by
 *  tapping their own header — this only decides the starting state whenever the shown period
 *  changes. */
function defaultOpenWeeks(offsetPeriods: number, targetDate: string): { open1: boolean; open2: boolean } {
  const weeks = getPayrollPeriodWeeks(offsetPeriods);
  if (weeks.week2.days.includes(targetDate)) return { open1: false, open2: true };
  return { open1: true, open2: false };
}

/**
 * Round fourteen (CB, Oct 2026, on this exact page: "is there some way that we could show
 * aesthetically cleanly in a way where it's like a drop down to see... since it's 2 week
 * intervals, that there's a drop down to see... that first week and then... that second week...
 * if I switch to the next week, then it will see the next pay period" — approved via the
 * timesheet-period-accordion-v1 mockup): this page used to page one calendar week at a time
 * (getWeek(offset)) and render a single flat day list. It now pages a whole PAY PERIOD at a
 * time (getPayrollPeriodWeeks(offset), same PayrollPeriodSwitcher pill My Tasks/Logged hours
 * already use, capped at the current period same as the old "Next" button was), fetching both
 * weeks' entries in one call, with each of the period's two weeks shown as its own collapsible
 * section (WeekAccordionBlock below) instead of one continuous 7-day stack — see
 * defaultOpenWeeks above for which week starts open.
 *
 * This same round also folds in two smaller requests CB had already approved separately and
 * which this redesign absorbs: the "2-week report" link that used to need its own place in the
 * sidebar (now just part of WeeklyTotalSidebar's period summary card — see that file) and the
 * mobile reorder that moves that whole card above the day list on narrow screens (order-first
 * lg:order-2 below — see that file's own doc comment for the rest of that story).
 *
 * The Reports page's unapproved-entries banner still deep-links here with `?week=<date>` (its
 * own doc comment, and src/types/index.ts's TimeSessionDTO, both still describe it that way —
 * only what this page DOES with that date changes): it now lands on whichever PERIOD that date
 * falls in (payrollPeriodOffsetForDate, same cap-at-current rule as before) with that date's own
 * week auto-opened, instead of landing on a single calendar week.
 */
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
  const [openWeeks, setOpenWeeks] = useState(() => defaultOpenWeeks(0, todayDateKey()));
  const [entries, setEntries] = useState<TimeEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [editTimesError, setEditTimesError] = useState("");

  const weeks = getPayrollPeriodWeeks(offset);

  // Pages to a different pay period (prev/next/"Jump to current" on PayrollPeriodSwitcher) —
  // always resets the accordion to that period's own default-open week (see defaultOpenWeeks),
  // never leaves whatever was open/closed in the previous period showing stale state.
  function goToOffset(newOffset: number) {
    setOffset(newOffset);
    setOpenWeeks(defaultOpenWeeks(newOffset, todayDateKey()));
  }

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(
        `/api/time/timesheet?employeeId=${employeeId}&start=${weeks.period.start}&end=${weeks.period.end}`
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntries(data.entries);
      setLoadState(data.entries.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  // Oct 2026, reworked round fourteen: picks up ?week=<date> from the Reports page's
  // unapproved-entries banner (CB: "there should be a way that we could kind of view those
  // entries... so we could go back there") and lands this page on the PAY PERIOD that date
  // falls in (not just a calendar week, now that this page pages by period), with that date's
  // own week auto-opened — same window.location.search read + clear-after-read pattern
  // TeamScheduleView's own ?dateFrom= deep link already uses, for the same Suspense-boundary
  // reason. Clamped at the current period (never into the future) same as the old clamp-at-0
  // did for calendar weeks, since a crafted/odd date shouldn't push this past what the "Next"
  // button itself allows.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const week = params.get("week");
    window.history.replaceState(null, "", window.location.pathname);
    if (!week) return;
    const clamped = Math.min(getCurrentPayrollPeriodOffset(), payrollPeriodOffsetForDate(week));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(clamped);
    setOpenWeeks(defaultOpenWeeks(clamped, week));
  }, []);

  useEffect(() => {
    // Fetch-on-mount / on-period-or-employee-change: this widget has no server-rendered
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

  // Round fourteen: aggregated across the WHOLE period (both weeks) for WeeklyTotalSidebar's
  // summary card, plus each week's own subtotal (week1Minutes/week2Minutes) for its accordion
  // header — same byDate/bucket logic ReviewTimesheetView has always computed here (originally
  // for a single calendar week — see round 4's own doc comment history in WeeklyTotalSidebar.tsx),
  // just run across 12 days instead of 7. A day later in the period with no entry yet is
  // "Upcoming," same as TimesheetTable's own isFuture check — it isn't counted as "Not logged"
  // here either, for the same reason.
  const entryByDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const week1DaySet = new Set(weeks.week1.days);
  const week2DaySet = new Set(weeks.week2.days);
  const week1Minutes = entries
    .filter((e) => week1DaySet.has(e.workDate.slice(0, 10)))
    .reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);
  const week2Minutes = entries
    .filter((e) => week2DaySet.has(e.workDate.slice(0, 10)))
    .reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);
  const periodMinutes = week1Minutes + week2Minutes;
  const periodCounts: Partial<Record<WeekBucket, number>> = {};
  const today = todayDateKey();
  for (const day of [...weeks.week1.days, ...weeks.week2.days]) {
    const entry = entryByDate.get(day);
    let bucket: WeekBucket | null = null;
    if (entry?.status === "APPROVED") bucket = "approved";
    else if (entry?.status === "AWAITING_APPROVAL") bucket = "awaiting";
    else if (entry?.status === "RETURNED") bucket = "returned";
    else if (entry?.status === "IN_PROGRESS") bucket = "inProgress";
    else if (!entry && day <= today) bucket = "notLogged";
    if (bucket) periodCounts[bucket] = (periodCounts[bucket] ?? 0) + 1;
  }

  async function approveAllAwaiting() {
    // Round fourteen: `entries` is now the whole period's fetch (both weeks), so this already
    // covers every awaiting day across both weeks in one tap, matching the approved mockup's
    // callout — no change needed here beyond what entries itself now contains.
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
        setActionError(data.error ?? "Unable to approve this period. Please try again.");
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

  const review: ReviewControls = {
    onApprove: approve,
    onReturn: returnEntry,
    busyEntryId,
    ...(canEditFlaggedTimeEntries ? { onEditTimes: editTimes, editError: editTimesError } : {}),
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <PayrollPeriodSwitcher offset={offset} onOffsetChange={goToOffset} capNextAtCurrent label="Pay period" />

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
        // Round 4 (CB, Oct 2026) originally split this into the day list plus a sticky "Weekly
        // total" sidebar on desktop; round fourteen keeps that same two-column grid (the day
        // list is now the two week accordions below instead of one flat 7-day stack) and adds
        // `order-first lg:order-2` on the summary card's own grid item so it renders ABOVE the
        // accordions on mobile (weekly-total-mobile-order-v1 mockup) while staying beside them,
        // unchanged, on desktop (`lg:order-1`/`lg:order-2` restore the original left/right order
        // there — see WeeklyTotalSidebar.tsx's own doc comment for the rest of that story).
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
          <div className="lg:order-1 flex flex-col gap-3">
            <WeekAccordionBlock
              weekLabel="Week 1"
              rangeLabel={formatWeekRange(weeks.week1.start, weeks.week1.end)}
              days={weeks.week1.days}
              entries={entries}
              review={review}
              open={openWeeks.open1}
              onToggle={() => setOpenWeeks((w) => ({ ...w, open1: !w.open1 }))}
              subtotalMinutes={week1Minutes}
            />
            <WeekAccordionBlock
              weekLabel="Week 2"
              rangeLabel={formatWeekRange(weeks.week2.start, weeks.week2.end)}
              days={weeks.week2.days}
              entries={entries}
              review={review}
              open={openWeeks.open2}
              onToggle={() => setOpenWeeks((w) => ({ ...w, open2: !w.open2 }))}
              subtotalMinutes={week2Minutes}
            />
          </div>
          <div className="order-first lg:order-2">
            <WeeklyTotalSidebar
              periodLabel={formatWeekRange(weeks.period.start, weeks.period.end)}
              totalMinutes={periodMinutes}
              counts={periodCounts}
              periodEnd={weeks.period.end}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Round fourteen — one pay period's Week 1 or Week 2, collapsed to a single header row (its
 *  label, date range, and its own subtotal) until tapped open to show that week's day cards —
 *  the same TimesheetTable this page always used, just handed one week's worth of `days` at a
 *  time instead of the whole period at once, with `entries` passed through unfiltered (its
 *  byDate lookup only ever matches the days it's told about). Kept local to this file since
 *  nothing else uses this particular accordion chrome. */
function WeekAccordionBlock({
  weekLabel,
  rangeLabel,
  days,
  entries,
  review,
  open,
  onToggle,
  subtotalMinutes,
}: {
  weekLabel: string;
  rangeLabel: string;
  days: string[];
  entries: TimeEntryDTO[];
  review: ReviewControls;
  open: boolean;
  onToggle: () => void;
  subtotalMinutes: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left hover:bg-black/[0.02]"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-bold">{weekLabel}</span>
          <span className="text-xs text-muted">{rangeLabel}</span>
        </span>
        <span className="flex items-center gap-2.5">
          <span className="tabular-nums text-sm font-semibold text-muted">{formatMinutes(subtotalMinutes)}</span>
          <ChevronDownIcon className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          <TimesheetTable days={days} entries={entries} review={review} hideSummaryBar />
        </div>
      )}
    </div>
  );
}
