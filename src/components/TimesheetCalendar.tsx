"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import StatusPill from "@/components/StatusPill";
import PtoStatusPill from "@/components/PtoStatusPill";
import { ChevronDownIcon } from "@/components/icons";
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
import { getMonth, type Month } from "@/lib/month";
import type { PtoRequestDTO, PtoStatus, PtoType, TimeEntryDTO, TimeEntryStatus } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

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

interface MonthSlot {
  offset: number;
  month: Month;
  entries: TimeEntryDTO[];
  loadState: LoadState;
}

/** How far back the calendar will scroll before it stops offering more — 60 months (5 years)
 *  is far more history than a pilot company needs, and an outer bound keeps a very determined
 *  scroller from firing off requests forever. */
const EARLIEST_OFFSET = -60;

/** How far ahead the calendar shows, so people can block off PTO in advance rather than only
 *  being able to see/click days in the current month (CB, Sept 2026: "probably six months
 *  out"). Unlike the past direction, this is a small, fixed range rather than an infinite
 *  lazy-loaded scroll — all of it loads up front, no IntersectionObserver needed. */
const MAX_FUTURE_OFFSET = 6;

/**
 * The employee's own "My Time" page, as a month calendar (CB's ask, modeled on the Airbnb
 * host calendar: a number per day, click a day to see/edit the detail) rather than one week's
 * table at a time. Deliberately a NEW component rather than a rework of TimesheetTable — that
 * component is also used by the supervisor/HR review page (src/app/(portal)/team/[employeeId]/
 * ReviewTimesheetView.tsx) with a completely different action set (Approve/Return, not
 * edit-and-resubmit), and this redesign was scoped to My Time only. TimesheetTable is untouched.
 *
 * Also folds in requesting PTO directly from the calendar. After CB watched an actual
 * screen recording of the Airbnb host calendar, several things about earlier versions of this
 * were wrong relative to that reference and got fixed here:
 *   1. The day panel was a centered/bottom overlay with a dark backdrop that blocked the
 *      calendar underneath it. Airbnb's panel is non-blocking — it docks to the side (a small
 *      floating card on a phone) and the calendar grid stays visible and clickable while it's
 *      open. There is deliberately no backdrop element here for that reason, and on a phone the
 *      panel is capped at half the viewport height and floats above the bottom tab bar rather
 *      than covering the whole screen, so there's always calendar left to see and scroll.
 *   2. Airbnb lets you click a second date to extend the first into a multi-day range (the
 *      panel then edits all of it at once) rather than one day at a time. `selection` below
 *      is `{start, end}` rather than a single date for exactly this — clicking a second empty,
 *      future day next to an already-selected one forms a range; the PTO request form then
 *      covers the whole range in one submit, using the exact same startDate/endDate/hours
 *      shape the Time Off page's own multi-day form already sends.
 *   3. Airbnb's calendar isn't one month with prev/next buttons — it's a single continuously
 *      scrolling list of months, and you keep scrolling to go further back. This component
 *      does the same for the past: scrolling down past the current month lazily fetches and
 *      appends one earlier month at a time (via an IntersectionObserver on a sentinel at the
 *      bottom of the loaded list), capped at EARLIEST_OFFSET.
 *
 *      Forward is different: rather than an unbounded lazy scroll, the next MAX_FUTURE_OFFSET
 *      months (6, as of CB's Sept 2026 ask to let people "block off" time in advance) load
 *      eagerly above the current month, all at once — small and fixed enough that lazy-loading
 *      would just be extra complexity for no benefit. The list mounts scrolled to the current
 *      month (see the scrollIntoView effect below) so this doesn't change what's on screen on
 *      first load; scrolling up reaches the future months, scrolling down still reaches the
 *      past ones exactly as before.
 *   4. The calendar itself is a full-width column, not a fixed narrow card with a wide gutter
 *      of empty page beside it — the day panel is a fixed-width column docked next to it (and
 *      pinned in place with `sticky` while the month list scrolls underneath it on sm+), so the
 *      calendar gets whatever room the page actually has, the way Airbnb's does.
 */
export default function TimesheetCalendar({
  loadEntries,
  refreshKey,
  correction,
  ptoRequests,
  pto,
}: {
  /** Fetches one month's entries — owned by the page (it knows the API route), this component
   *  just decides *which* months to ask for and when. */
  loadEntries: (month: Month) => Promise<TimeEntryDTO[]>;
  /** Bump this (e.g. after a correction is resubmitted) to re-fetch every month currently
   *  loaded, since this component — not the page — now owns which months' data is in memory. */
  refreshKey: number;
  correction: CorrectionControls;
  ptoRequests: PtoRequestDTO[];
  pto: PtoDayControls;
}) {
  // Descending offsets from MAX_FUTURE_OFFSET down to 0 — furthest-future month first, current
  // month last — so the array is already in top-to-bottom render order with no reordering logic
  // needed: future months (loaded eagerly, all at once) sit above the current month, and past
  // months (loaded lazily as you scroll down, unchanged from before) get appended after it.
  const [months, setMonths] = useState<MonthSlot[]>(() =>
    Array.from({ length: MAX_FUTURE_OFFSET + 1 }, (_, i) => {
      const offset = MAX_FUTURE_OFFSET - i;
      return { offset, month: getMonth(offset), entries: [], loadState: "loading" as LoadState };
    })
  );
  const [reachedStart, setReachedStart] = useState(false);
  // Tracks the latest `months` for the refresh effect below to read without needing `months`
  // itself in that effect's deps (which would re-run it on every fetch, not just on refreshKey).
  const monthsRef = useRef(months);
  useEffect(() => {
    monthsRef.current = months;
  }, [months]);
  const earliestLoadedOffsetRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // The current month's own wrapper div, so the mount effect below can scroll straight to it —
  // otherwise the page would land on the topmost (furthest-future) month instead of today's.
  const currentMonthRef = useRef<HTMLDivElement | null>(null);

  async function loadMonth(offset: number) {
    const month = getMonth(offset);
    try {
      const entries = await loadEntries(month);
      setMonths((prev) =>
        prev.map((s) => (s.offset === offset ? { ...s, entries, loadState: entries.length === 0 ? "empty" : "ready" } : s))
      );
    } catch {
      setMonths((prev) => prev.map((s) => (s.offset === offset ? { ...s, loadState: "error" } : s)));
    }
  }

  useEffect(() => {
    // All eagerly-loaded months (0..MAX_FUTURE_OFFSET) fetch in parallel on mount — there's no
    // reason to serialize them, and it's only ever 7 requests.
    for (let offset = 0; offset <= MAX_FUTURE_OFFSET; offset++) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadMonth(offset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lands the page on the current month rather than the furthest-future one now sitting above
  // it — runs once on mount; the current month's wrapper div already exists in the very first
  // render (all 0..MAX_FUTURE_OFFSET slots are in initial state, not lazily added), so there's
  // no need to wait on data actually loading. useLayoutEffect (not useEffect) so this scroll
  // happens before the browser paints, avoiding a visible flash of the future months first.
  useLayoutEffect(() => {
    currentMonthRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  // Re-fetch every month already in memory — used after a correction is resubmitted elsewhere
  // in the tree, since that can change hours on a month that's already loaded here. Skips the
  // very first render (refreshKey starts at 0 and nothing has been submitted yet).
  const skipFirstRefresh = useRef(true);
  useEffect(() => {
    if (skipFirstRefresh.current) {
      skipFirstRefresh.current = false;
      return;
    }
    const offsets = monthsRef.current.map((s) => s.offset);
    setMonths((prev) => prev.map((s) => ({ ...s, loadState: "loading" })));
    offsets.forEach((offset) => loadMonth(offset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function loadMore() {
    if (earliestLoadedOffsetRef.current <= EARLIEST_OFFSET) {
      setReachedStart(true);
      return;
    }
    const nextOffset = earliestLoadedOffsetRef.current - 1;
    earliestLoadedOffsetRef.current = nextOffset;
    setMonths((prev) => [...prev, { offset: nextOffset, month: getMonth(nextOffset), entries: [], loadState: "loading" }]);
    loadMonth(nextOffset);
    if (nextOffset <= EARLIEST_OFFSET) setReachedStart(true);
  }

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // rootMargin loads the next month a bit before the sentinel is actually on screen, so
    // scrolling feels continuous rather than pausing on a spinner every month.
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed[0].isIntersecting) loadMore();
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merged across every month currently loaded (not just whichever one is "current"), so a
  // selected day resolves correctly no matter which loaded month it lives in.
  const byDateAll = useMemo(
    () => new Map(months.flatMap((s) => s.entries).map((e) => [e.workDate.slice(0, 10), e])),
    [months]
  );
  const ptoMap = useMemo(() => ptoByDate(ptoRequests), [ptoRequests]);

  // A day is "eligible" when there's nothing to show for it yet and it's still ahead of us —
  // exactly the condition under which "Request time off" makes sense. Only eligible days can
  // be chained into a multi-day range; clicking any other kind of day always resets the
  // selection to that single day instead. Today counts as eligible too (not just strictly
  // future) so a same-day request — calling in sick this morning, say — works straight from
  // the calendar rather than needing a separate "any date" form.
  function isEligible(dateKey: string): boolean {
    return !byDateAll.has(dateKey) && !ptoMap.has(dateKey) && dateKey >= todayDateKey();
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

  // Closed by default — opens as a side panel (floating card on a phone) when a day is
  // clicked, rather than always showing some day's detail.
  const [selection, setSelection] = useState<Selection | null>(null);

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
  const singleEntry = selection && !isRange ? byDateAll.get(selection.start) : undefined;
  const singlePto = selection && !isRange ? ptoMap.get(selection.start) : undefined;

  return (
    // Calendar column is a full-width flex-1 sibling of the (fixed-width, sticky) day panel —
    // together they take up whatever room the page gives them rather than sitting in a fixed
    // narrow card with empty page beside it.
    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
      <div className="flex-1 min-w-0 space-y-6">
        {/* Always the topmost thing rendered — months[0] is always the MAX_FUTURE_OFFSET slot,
            since nothing ever loads or prepends anything ahead of it. */}
        <p className="text-center text-xs text-muted/60 py-2">
          You can plan up to {MAX_FUTURE_OFFSET} months ahead — scroll up for future months, or down for past ones.
        </p>
        {months.map((slot) => (
          // The current month gets a ref so the mount effect above can scroll straight to it —
          // otherwise the page would land on the future months now sitting above it instead of
          // today's.
          <div key={slot.offset} ref={slot.offset === 0 ? currentMonthRef : undefined}>
            <MonthSection slot={slot} selection={selection} ptoMap={ptoMap} onDayClick={handleDayClick} />
          </div>
        ))}

        {reachedStart ? (
          <p className="text-center text-xs text-muted/60 py-2">That&apos;s as far back as your history goes.</p>
        ) : (
          <div ref={sentinelRef} className="h-4" aria-hidden />
        )}
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

function MonthSection({
  slot,
  selection,
  ptoMap,
  onDayClick,
}: {
  slot: MonthSlot;
  selection: Selection | null;
  ptoMap: Map<string, PtoRequestDTO>;
  onDayClick: (dateKey: string) => void;
}) {
  const { month, entries, loadState } = slot;
  const byDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const monthlyMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);
  const clickable = loadState === "ready" || loadState === "empty";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-serif font-semibold text-lg">{month.label}</h2>
        <p className="text-xs text-muted">
          {loadState === "loading"
            ? "Loading…"
            : loadState === "error"
              ? "Unable to load"
              : monthlyMinutes > 0
                ? `${formatMinutes(monthlyMinutes)} logged`
                : "Nothing logged"}
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
                  <div key={day.date} className="h-14 sm:h-20 rounded-lg flex items-start justify-start p-2">
                    <span className="text-xs text-muted/30 tabular-nums">{dayNumber}</span>
                  </div>
                );
              }

              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onDayClick(day.date)}
                  disabled={!clickable}
                  className={`relative h-14 sm:h-20 rounded-lg border p-2 flex flex-col items-start justify-between text-left transition-colors disabled:opacity-40 ${
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
  const canRequest = !entry && !pto && (isRange || selection.start >= todayDateKey());
  const headerLabel = isRange
    ? `${formatDateRange(selection.start, selection.end)} · ${dayCount(selection.start, selection.end)} days`
    : fullDateLabel(selection.start);

  return (
    // On a phone: a small floating card (margin on every side, capped at half the viewport
    // height, fully rounded) rather than an edge-to-edge sheet — the calendar underneath stays
    // mostly visible and still scrolls, and it floats clear of the bottom tab bar (BottomNav is
    // ~fixed bottom-0, so this sits at bottom-24 rather than bottom-0). At sm+, `sm:sticky
    // sm:top-4` cancels all of that and docks it as a normal-width column next to the calendar
    // that stays pinned near the top of the viewport while the month list scrolls underneath it
    // — close to the grid and always in view, the way Airbnb's own panel behaves.
    <div
      className="fixed z-50 bg-neutral-900 text-white shadow-2xl overflow-y-auto p-4
        inset-x-3 bottom-24 max-h-[50vh] rounded-3xl
        sm:sticky sm:top-4 sm:inset-auto sm:z-auto sm:max-h-none sm:w-[320px] sm:shrink-0 sm:rounded-2xl"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium">{headerLabel}</p>
        <button
          onClick={onClose}
          aria-label="Close"
          className="h-7 w-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-base leading-none shrink-0"
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
      <div className="rounded-2xl bg-white/5 p-4">
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
          className="w-full rounded-2xl bg-white/10 hover:bg-white/20 disabled:opacity-50 py-3 text-sm font-medium"
        >
          {isCancelling ? "Cancelling…" : "Cancel request"}
        </button>
      )}

      {entry && (
        <div className="rounded-2xl bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs text-white/50 uppercase tracking-wide">Time also logged this day</p>
            <StatusPill status={entry.status} />
          </div>
          <SessionList sessions={entry.sessions} />
          <div className="mt-2">
            <Stat label="Hours" value={formatMinutes(entry.totalMinutes)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** One clock-in/clock-out pair per line, oldest first — used by both the plain read-only day
 *  detail (below) and the "time also logged" summary inside PtoDetail above. */
function SessionList({ sessions }: { sessions: TimeEntryDTO["sessions"] }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-white/60">No time logged.</p>;
  }
  return (
    <div className="space-y-1">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center justify-between text-sm">
          <span>
            {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "in progress"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A day's edited session list, as HH:MM <input type="time"> strings until submit. */
interface SessionRow {
  clockIn: string;
  clockOut: string;
}

function TimeEntryDetail({ entry, correction }: { entry: TimeEntryDTO; correction: CorrectionControls }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);

  const isBusy = correction.busyEntryId === entry.id;
  const isCorrectable = entry.status === "RETURNED";
  const dateKey = entry.workDate.slice(0, 10);

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
      .map((r) => ({ clockIn: combineDateAndTime(dateKey, r.clockIn), clockOut: combineDateAndTime(dateKey, r.clockOut) }))
      .filter((s): s is { clockIn: Date; clockOut: Date } => s.clockIn !== null && s.clockOut !== null);
    correction.onSubmit(entry.id, sessions);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <StatusPill status={entry.status} />
      </div>

      <SessionList sessions={entry.sessions} />
      <div className="mt-2">
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
                    className="h-8 w-8 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-sm leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((r) => [...r, { clockIn: "", clockOut: "" }])}
              className="text-xs text-white/70 hover:text-white underline"
            >
              + Add another session
            </button>
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
  const [hours, setHours] = useState(8 * n);
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    controls.onSubmit({ startDate, endDate }, { type, hours, reason: reason.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-white/60">
        Nothing logged for {n === 1 ? "this day" : `these ${n} days`} yet. Request{" "}
        {n === 1 ? "it" : "them"} off instead?
      </p>

      {/* Each field its own rounded, solid-fill card — same shape as the Available / Smart
          Pricing / Custom settings rows in the Airbnb host calendar's day panel. */}
      <div className="rounded-2xl bg-white/5 p-4">
        <label className="block text-xs text-white/50 mb-1">Type of leave</label>
        {/* relative wrapper + appearance-none select + our own chevron: appearance-none drops
            the browser's native arrow (needed to strip the rest of the native chrome this field
            doesn't want), so without a stand-in it just looks like plain text, not a dropdown.
            The option list itself is still browser-native chrome we can't fully restyle, but
            giving each <option> a dark bg/light text at least keeps it from popping up as a
            stark white box against this dark panel. */}
        <div className="relative">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PtoType)}
            className="w-full bg-transparent text-base font-medium outline-none appearance-none cursor-pointer pr-6"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t} className="bg-neutral-900 text-white">
                {PTO_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
        </div>
      </div>

      <div className="rounded-2xl bg-white/5 p-4">
        <label className="block text-xs text-white/50 mb-2">Hours{n > 1 ? " (total)" : ""}</label>
        <HoursStepper value={hours} onChange={setHours} />
      </div>

      <div className="rounded-2xl bg-white/5 p-4">
        <label className="block text-xs text-white/50 mb-1">Reason / comment (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-white/30"
          placeholder="Add a note for your supervisor"
        />
      </div>

      {controls.error && <p className="text-xs text-rose-300">{controls.error}</p>}

      <button
        type="submit"
        disabled={controls.submitting}
        className="w-full rounded-2xl bg-white text-neutral-900 hover:bg-white/90 disabled:opacity-50 py-3 text-sm font-medium"
      >
        {controls.submitting ? "Submitting…" : "Request time off"}
      </button>
    </form>
  );
}

/** Increment/decrement stepper — mirrors the −  N  + control the Airbnb host calendar uses
 *  for things like "Minimum nights" (CB pointed at that as the reference), used here for
 *  hours instead of typing a number directly. */
function HoursStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const step = 0.5;
  const min = 0.5;

  function round(v: number): number {
    return Math.round(v * 100) / 100;
  }

  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => onChange(round(Math.max(min, value - step)))}
        disabled={value <= min}
        aria-label="Decrease hours"
        className="h-9 w-9 rounded-full border border-white/25 flex items-center justify-center text-lg leading-none hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        −
      </button>
      <span className="text-lg font-semibold tabular-nums">
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </span>
      <button
        type="button"
        onClick={() => onChange(round(value + step))}
        aria-label="Increase hours"
        className="h-9 w-9 rounded-full border border-white/25 flex items-center justify-center text-lg leading-none hover:bg-white/10"
      >
        +
      </button>
    </div>
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
