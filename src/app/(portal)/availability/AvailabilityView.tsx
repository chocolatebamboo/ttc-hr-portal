"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import AvailabilityCalendar, { Panel as AvailabilityPanel, useAvailabilityPanel } from "@/components/AvailabilityCalendar";
import LoggedHoursSection from "@/components/LoggedHoursSection";
import MyAvailabilityPreview from "@/components/MyAvailabilityPreview";
import TimeOffRequests from "@/components/TimeOffRequests";
import { ChevronDownIcon } from "@/components/icons";
import type { AvailabilityDTO, AvailabilitySlot, PtoType, TimeEntryDTO, PtoRequestDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** Sunday-start week containing `d`, at local midnight — same "plain client-side Date, no
 *  timezone machinery" convention this file's own showCutoffReminder already uses; this is a
 *  UI convenience widget, not a payroll calculation. */
function startOfWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

/** "09:00" -> "9", "13:30" -> "1:30" — the This week strip's own compact hour, dropped down to
 *  just the number (no AM/PM) since the strip's day cells are too narrow for a full time range;
 *  formatTime12h (availability-format.ts) stays the source of truth everywhere a real time
 *  needs to read unambiguously. */
function compactHour(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}` : `${hour12}:${String(m).padStart(2, "0")}`;
}

/** Redesign follow-up (Sept 2026), CB: "I should be able to slide to see the other dates either
 *  in the future or the past. And then this week will update to... the prior or future
 *  [week]." Once the strip isn't showing the actual current week anymore, "This week" no longer
 *  reads true — this is what it shows instead, e.g. "Sep 28 – Oct 4" (or "Sep 28 – Oct 4, 2027"
 *  once it's not even the current year, so a far swipe never reads as ambiguous). */
function weekRangeLabel(start: Date): string {
  const end = addDays(start, 6);
  const thisYear = new Date().getFullYear();
  const yearSuffix = start.getFullYear() !== thisYear || end.getFullYear() !== thisYear ? ", " + end.getFullYear() : "";
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}${yearSuffix}`;
}

/**
 * "Availability" (CB, Sept 2026): tap the dates you're available on a calendar, same
 * experience as My Time, and submit them for a supervisor or HR/Super Admin to approve — "so
 * that we don't have to manually keep on asking them what's their availability." Every
 * submission is kept as its own record (TeamAvailabilitySection / AvailabilityAdminView), not
 * a single pattern that gets overwritten, so there's a real history of what was actually
 * offered and approved over time.
 *
 * Redesign (Sept 2026, confirmed via a mockup screenshot — "I could see everything holistically
 * in a clean, minimalistic [way], yet all the information is there... whenever those things are
 * approved and they see all their tasks and everything, it's organized in the best way
 * possible"): replaces the four-accordion layout from Correction brief #6 with real, always-
 * visible widgets — a "This week" strip (this week's dates + status at a glance, one button to
 * add more), a "Your submissions" list showing the actual pending/decided dates instead of just
 * a collapsed count, and two compact stat tiles (Logged hours this week, Time off). Nothing here
 * is hidden behind a tap by default; the full calendar and the full Logged hours / Time off
 * detail views (corrections, swipe-to-delete, per-request messaging — none of that goes away)
 * are one tap further in, opened from the widget that summarizes them, instead of always-closed
 * accordions guessed at from a label alone.
 */
export default function AvailabilityView({ employeeId }: { employeeId: string }) {
  const [submissions, setSubmissions] = useState<AvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Which submission (if any) a clear/cancel request is currently in flight for — lets that
  // one submission's button show a busy state without a whole separate loading screen.
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // CB, Sept 2026: "if I click on one of the dates and I say clear... it deletes all of them
  // that I selected" — a single-date removal within a multi-date submission, tracked separately
  // from cancellingId (which is submission-wide) so just the one date's own button goes busy.
  // Keyed "submissionId:date" since a submission alone doesn't uniquely identify which of its
  // dates is being removed.
  const [removingDateKey, setRemovingDateKey] = useState<string | null>(null);
  // CB, Sept 2026: "we should be able to remove the whole thing entirely if we wanted to" — the
  // real, permanent delete, only ever legal once a submission is already Cancelled (see
  // deleteAvailabilitySubmission's doc comment in src/lib/availability.ts). Tracked the same
  // shape as cancellingId, just for this separate action.
  const [deletingSubmissionId, setDeletingSubmissionId] = useState<string | null>(null);
  // CB, Sept 2026, after the first version handed the tapped dates off to the Time Off section
  // below the calendar: "it needs to live within that pop up" — a time-off request submitted
  // right from the calendar's own date-tap popup, in flight or failed. Distinct from
  // submitting/error above, which are the AVAILABILITY submit's own state — these two requests
  // are unrelated actions that just happen to originate from the same popup.
  const [submittingTimeOff, setSubmittingTimeOff] = useState(false);
  const [timeOffError, setTimeOffError] = useState<string | undefined>();
  // Bumped (to a fresh value, same "nonce" idea as a cache-buster) every time a time-off request
  // is submitted from the calendar popup, so the Time Off section below can refetch and pick up
  // the new request — that list otherwise only loads once on its own mount, and has no other way
  // to know a request was just created somewhere else on this page.
  const [ptoRefreshSignal, setPtoRefreshSignal] = useState<number | null>(null);
  // Redesign: the full calendar is no longer one of four peer accordions — it's opened from
  // either the "This week" strip's "Full calendar" link or its "Add availability" button, both
  // of which just flip this same flag. Starts closed so the widgets above are what actually
  // loads first, same "don't force the calendar to dominate the page" reasoning Brief #6 already
  // established, just reached a different way now.
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Redesign follow-up (Sept 2026), CB: "I should be able to click within the days, within the
  // week and select... I don't necessarily want to pull up the full calendar every single time."
  // Which week the "This week" strip below is currently showing, relative to the real current
  // week (0) — CB: "I should be able to slide to see the other dates either in the future or
  // the past." Tapping a date in the strip no longer opens this full calendar at all; it opens
  // its own compact inline panel instead (see the strip's own render below and
  // useAvailabilityPanel), reusing the exact same add/view/cancel/delete/time-off UI as this
  // calendar's panel, just anchored right there in the strip's own card. "Full calendar" (the
  // toggle right below) stays for browsing further out than one week at a time.
  const [weekOffset, setWeekOffset] = useState(0);
  // Same "opened from a summary, not always-open" treatment for the two stat tiles' own detail
  // views — tapping "Logged hours" or "Time off" (or "Request time off" inside that tile) reveals
  // the exact same LoggedHoursSection / TimeOffRequests this page always had, corrections and
  // swipe-to-delete and per-request messaging all still intact; it's only the entry point that
  // changed from a blind accordion label to a real number.
  const [loggedHoursOpen, setLoggedHoursOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  // QA pass (Sept 2026), CB: a soft reminder about the Sunday submission cutoff — purely a UI
  // nudge, computed client-side from today's own weekday, not a new schema field or scheduled
  // job. The actual protective behavior (nothing self-scheduled becomes a real shift without
  // going through decideAvailabilityDate → convertAvailabilityDateToShift) is already fully
  // enforced server-side regardless of this banner; this only helps someone submit on time in
  // the first place. Shown Thursday through Sunday — the stretch where "next week" is close
  // enough that a reminder is actually useful — and quietly absent the rest of the week rather
  // than a permanent fixture nobody reads anymore.
  const [showCutoffReminder] = useState(() => [0, 4, 5, 6].includes(new Date().getDay()));

  // Redesign: the "Logged hours" stat tile's own number — this calendar week's (Sun–Sat) total
  // logged minutes, same underlying /api/time/timesheet?start=&end= endpoint LoggedHoursSection
  // already uses and the exact same "sum every entry's totalMinutes, no status filter" math as
  // its own "Total, last N days" row, just scoped to this week instead of a 90-day window. CB
  // confirmed the pay period this tile should reflect is the same Sun–Sat week as the "This
  // week" strip right above it, so both widgets read off one shared boundary.
  const [weeklyMinutes, setWeeklyMinutes] = useState<number | null>(null);
  // "Time off" stat tile's own number — PENDING or APPROVED requests that haven't ended yet
  // (endDate >= today), i.e. still something to plan around, mirroring what "upcoming" means
  // everywhere else time-off shows up in this app (TimeOffSection's own dashboard list).
  const [upcomingPtoCount, setUpcomingPtoCount] = useState<number | null>(null);

  // The REAL current calendar week — deliberately independent of weekOffset below (the
  // "Logged hours" stat tile always reflects the actual current pay period, regardless of
  // which week the "This week" strip happens to be scrolled to at the moment).
  const weekStart = startOfWeek(new Date());
  const todayKey = toDateKey(new Date());

  // Which week the "This week" strip is currently showing (see weekOffset's own doc comment
  // above) — a plain function rather than a memoized value since it's cheap and weekOffset is
  // its only real input.
  function stripWeekDays(offset: number): Date[] {
    const start = startOfWeek(addDays(new Date(), offset * 7));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  // The strip's own day-tap interaction — same hook AvailabilityCalendar's full month grid uses
  // (see useAvailabilityPanel's own doc comment for why this is a separate instance rather than
  // a shared one), so tapping a date here opens the identical add/view/cancel/delete/time-off
  // panel, just inline in this card instead of the full calendar below.
  const stripPanel = useAvailabilityPanel({
    submissions,
    onCancel: handleCancel,
    onDeleteSubmission: handleDeleteSubmission,
    onSubmitTimeOff: handleSubmitTimeOff,
  });

  // Redesign follow-up (Sept 2026), CB: "I should be able to slide to see the other dates
  // either in the future or the past." Native CSS scroll-snap rather than hand-rolled touch/
  // pointer math (same reasoning SwipeReveal's own doc comment gives — there's no browser in
  // this sandbox to verify touch math against) — three week-panels (prev/current/next) sit
  // side by side, scrolled to the middle one; once the browser's own snap settles on the left
  // or right panel, weekOffset shifts by one and the recenter effect below instantly (no
  // animation — a plain `scrollLeft` assignment, not `scrollTo`) jumps back to the middle
  // position, which is now showing the new set of three weeks. The visible result reads as an
  // endless strip, without this component ever tracking a raw drag delta itself.
  const stripScrollRef = useRef<HTMLDivElement | null>(null);
  const stripScrollTimeout = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = stripScrollRef.current;
    if (!el) return;
    el.scrollLeft = el.clientWidth;
  }, [weekOffset]);

  useEffect(() => {
    return () => {
      if (stripScrollTimeout.current !== null) window.clearTimeout(stripScrollTimeout.current);
    };
  }, []);

  function handleStripScroll() {
    if (stripScrollTimeout.current !== null) window.clearTimeout(stripScrollTimeout.current);
    stripScrollTimeout.current = window.setTimeout(() => {
      const el = stripScrollRef.current;
      if (!el || el.clientWidth === 0) return;
      const ratio = el.scrollLeft / el.clientWidth;
      if (ratio < 0.5) setWeekOffset((o) => o - 1);
      else if (ratio > 1.5) setWeekOffset((o) => o + 1);
    }, 80);
  }

  // Whether tapping this date would show some highlight in the strip (CB: "if we select, it
  // should... have some level of that highlight") — mid-draft, or part of the submission
  // currently open in the strip's own inline panel.
  function isStripDateSelected(dateKey: string): boolean {
    if (dateKey in stripPanel.draft) return true;
    return !!stripPanel.viewingSubmission?.slots.some((s) => s.date === dateKey);
  }

  // CB, Sept 2026: "it needs to live within that pop up" — same POST /api/pto/requests the
  // shared TimeOffRequests widget's own form uses, just called directly from here since this
  // request originates entirely inside the calendar's popup rather than that widget's form.
  // Sparse tapped dates collapse to a single start–end range the same way the widget's own date
  // pickers would — PTO requests are always one continuous range, never a set of separate days.
  // Returns whether it succeeded so the calendar knows whether to clear its draft and close the
  // popup (success) or leave the popup and whatever was typed exactly as they were (failure).
  async function handleSubmitTimeOff(
    dates: string[],
    values: { type: PtoType; hours: number; reason?: string }
  ): Promise<boolean> {
    if (dates.length === 0) return false;
    const sorted = [...dates].sort();
    setSubmittingTimeOff(true);
    setTimeOffError(undefined);
    try {
      const res = await fetch("/api/pto/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: values.type,
          startDate: sorted[0],
          endDate: sorted[sorted.length - 1],
          hours: values.hours,
          reason: values.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTimeOffError(data.error ?? "Unable to submit your request. Please try again.");
        return false;
      }
      setPtoRefreshSignal(Date.now());
      return true;
    } catch {
      setTimeOffError("Unable to reach the server. Check your connection and try again.");
      return false;
    } finally {
      setSubmittingTimeOff(false);
    }
  }

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/availability");
      if (!res.ok) throw new Error();
      const data: { submissions: AvailabilityDTO[] } = await res.json();
      setSubmissions(data.submissions);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  // This week's total logged minutes for the "Logged hours" stat tile — best-effort, same
  // reasoning as every other secondary summary on this page: a tile that fails to load its own
  // number isn't worth failing the whole page over, it just shows a dash instead.
  async function loadWeeklyMinutes() {
    try {
      const start = toDateKey(weekStart);
      const end = toDateKey(addDays(weekStart, 6));
      const res = await fetch(`/api/time/timesheet?start=${start}&end=${end}`);
      if (!res.ok) throw new Error();
      const data: { entries: TimeEntryDTO[] } = await res.json();
      setWeeklyMinutes(data.entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0));
    } catch {
      setWeeklyMinutes(null);
    }
  }

  async function loadPtoStat() {
    try {
      const res = await fetch("/api/pto/requests");
      if (!res.ok) throw new Error();
      const data: { requests: PtoRequestDTO[] } = await res.json();
      const today = toDateKey(new Date());
      const upcoming = data.requests.filter(
        (r) => (r.status === "PENDING" || r.status === "APPROVED") && r.endDate.slice(0, 10) >= today
      );
      setUpcomingPtoCount(upcoming.length);
    } catch {
      setUpcomingPtoCount(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadWeeklyMinutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-pulls the "Time off" stat tile's own count whenever a time-off request is submitted from
  // the calendar popup (ptoRefreshSignal bump) as well as on first mount — same "one shared
  // signal, every interested reader watches it" shape TimeOffRequests' own refreshSignal prop
  // already uses.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPtoStat();
  }, [ptoRefreshSignal]);

  async function handleSubmit(slots: AvailabilitySlot[], note?: string) {
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to submit your availability. Please try again.");
        return;
      }
      setSubmissions((prev) => [data, ...prev]);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Clearing a Pending or Denied submission of your own (CB, Sept 2026: "they shouldn't just
  // be set in stone") — updates that one row in place to CANCELLED rather than refetching the
  // whole list, same pattern handleSubmit already uses for a freshly-created one.
  async function handleCancel(submissionId: string) {
    setCancellingId(submissionId);
    try {
      const res = await fetch(`/api/availability/${submissionId}/cancel`, { method: "POST" });
      if (!res.ok) return;
      const updated: AvailabilityDTO = await res.json();
      setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? updated : s)));
    } finally {
      setCancellingId(null);
    }
  }

  // Removes just one date from a Pending/Denied submission — the rest of that submission's
  // dates stay exactly as they were (see removeAvailabilityDate's doc comment).
  async function handleRemoveDate(submissionId: string, date: string) {
    const key = `${submissionId}:${date}`;
    setRemovingDateKey(key);
    try {
      const res = await fetch(`/api/availability/${submissionId}/dates/${date}`, { method: "DELETE" });
      if (!res.ok) return;
      const updated: AvailabilityDTO = await res.json();
      setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? updated : s)));
    } finally {
      setRemovingDateKey(null);
    }
  }

  // CB, Sept 2026: "we should be able to remove the whole thing entirely" — permanently, once
  // it's already Cancelled (see deleteAvailabilitySubmission's doc comment). Removes the row
  // from `submissions` outright on success, same as MyAvailabilityPreview's own delete.
  async function handleDeleteSubmission(submissionId: string) {
    setDeletingSubmissionId(submissionId);
    try {
      const res = await fetch(`/api/availability/${submissionId}`, { method: "DELETE" });
      if (!res.ok) return;
      setSubmissions((prev) => prev.filter((s) => s.id !== submissionId));
    } finally {
      setDeletingSubmissionId(null);
    }
  }

  return (
    <div className="md:h-full md:flex md:flex-col md:min-h-0 md:overflow-y-auto">
      <h1 className="page-title text-2xl mb-1 md:shrink-0">Availability</h1>
      <p className="text-sm text-muted mb-4 md:shrink-0">
        Tap the dates you&apos;re available, set a time for each, and submit them for your
        supervisor or HR to approve — so they don&apos;t have to ask you individually. Plan up to
        six months ahead.
      </p>

      {showCutoffReminder && (
        <div className="mb-4 md:shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Reminder: submit your availability for next week by Sunday so it can be reviewed and
          scheduled in time.
        </div>
      )}

      {/* "This week" — always visible, no tap required to see it. Each day that has an active
          submitted slot shows amber-filled with its compact hour range; today gets its own ring
          regardless of whether it's also submitted, so "today" and "submitted" read as two
          separate, layerable facts rather than one color doing double duty. A selected date (mid-
          draft, or whichever submission's detail is open below) gets the same solid accent fill
          the full calendar already uses for the same thing, so the two calendars agree on what
          "selected" looks like.
          Redesign follow-up (Sept 2026), CB: "I should be able to click within the days... and
          select" plus "I don't necessarily want to pull up the full calendar every single time"
          plus "I should be able to slide to see the other dates either in the future or the
          past." Tapping a day now opens a compact panel right in this card (stripPanel below,
          via useAvailabilityPanel) instead of the full calendar; the day grid itself is a
          three-week swipeable strip (see stripScrollRef's own doc comment above) with arrow
          buttons for anyone not on touch. "Full calendar" is still here, unchanged, for browsing
          further out than one week — it opens INSIDE this same card, right under the strip, so
          the whole thing still reads as one widget that expands rather than stacked cards. */}
      <div className="mb-4 md:shrink-0 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">{weekOffset === 0 ? "This week" : weekRangeLabel(stripWeekDays(weekOffset)[0])}</h2>
          <button
            type="button"
            onClick={() => setCalendarOpen((v) => !v)}
            className="text-xs font-medium text-accent-ink hover:underline flex items-center gap-1"
          >
            {calendarOpen ? (
              <>
                Hide calendar <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
              </>
            ) : (
              <>
                Full calendar <span aria-hidden>›</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o - 1)}
            aria-label="Previous week"
            className="shrink-0 h-14 w-5 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-black/[0.04]"
          >
            ‹
          </button>
          <div
            ref={stripScrollRef}
            onScroll={handleStripScroll}
            // CB, Sept 2026: "that pink outline that's on like Wednesday, it's like getting
            // clipped off for some reason" — the isToday ring below (`ring-2 ring-accent`) is a
            // box-shadow that paints OUTSIDE the button's own box, and setting overflow-x here
            // forces the browser to resolve overflow-y to "auto" too (per the CSS overflow spec,
            // an axis left at its "visible" default can't stay that way once the other axis
            // isn't), so a today cell sitting flush against this container's edge had its own
            // ring sheared off on whichever side touched the edge. `p-1` gives the ring's full
            // 2px a clear margin to paint into before hitting that clip boundary — the scroll-
            // snap math in the effects above measures off `clientWidth`, which already accounts
            // for this container's own padding, so the swipe/snap behavior is unaffected.
            className="flex-1 min-w-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide p-1"
          >
            {(["prev", "current", "next"] as const).map((pos) => {
              const offset = weekOffset + (pos === "prev" ? -1 : pos === "next" ? 1 : 0);
              return (
                <div key={pos} className="shrink-0 w-full snap-center grid grid-cols-7 gap-1.5">
                  {stripWeekDays(offset).map((d) => {
                    const dateKey = toDateKey(d);
                    const slot = stripPanel.byDate.get(dateKey)?.slots.find((s) => s.date === dateKey);
                    const isToday = dateKey === todayKey;
                    const isSelected = isStripDateSelected(dateKey);
                    return (
                      <button
                        type="button"
                        key={dateKey}
                        onClick={() => stripPanel.handleDayClick(dateKey)}
                        className={`flex flex-col items-center rounded-xl py-2 transition-colors ${
                          isSelected
                            ? "bg-accent-ink text-white"
                            : slot
                              ? "bg-amber-100 hover:bg-amber-200"
                              : "bg-black/[0.03] hover:bg-black/[0.06]"
                        } ${isToday ? "ring-2 ring-accent" : ""}`}
                      >
                        <span className={`text-[10px] font-medium uppercase ${isSelected ? "text-white/80" : "text-muted"}`}>
                          {d.toLocaleDateString(undefined, { weekday: "short" })}
                        </span>
                        <span className="text-sm font-semibold mt-0.5">{d.getDate()}</span>
                        {slot && !isSelected && (
                          <span className="text-[10px] text-amber-800 font-medium mt-0.5">
                            {compactHour(slot.startTime)} to {compactHour(slot.endTime)}
                          </span>
                        )}
                        {isSelected && <span className="text-[10px] font-medium mt-0.5">Selected</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o + 1)}
            aria-label="Next week"
            className="shrink-0 h-14 w-5 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-black/[0.04]"
          >
            ›
          </button>
        </div>

        {stripPanel.showPanel ? (
          <div className="mt-3.5">
            <AvailabilityPanel
              key={stripPanel.viewingSubmission?.id ?? "draft"}
              viewingSubmission={stripPanel.viewingSubmission}
              employeeId={employeeId}
              draftDates={stripPanel.draftDates}
              draft={stripPanel.draft}
              onUpdateTime={(dateKey, field, value) =>
                stripPanel.setDraft((d) => ({ ...d, [dateKey]: { ...d[dateKey], [field]: value } }))
              }
              onRemoveDate={(dateKey) =>
                stripPanel.setDraft((d) => {
                  const next = { ...d };
                  delete next[dateKey];
                  return next;
                })
              }
              onClearDraft={() => stripPanel.setDraft({})}
              onSubmitTimeOff={(values) => stripPanel.handleSubmitTimeOff(stripPanel.draftDates, values)}
              submittingTimeOff={submittingTimeOff}
              timeOffError={timeOffError}
              onSubmit={(note) => handleSubmit(stripPanel.draftDates.map((date) => ({ date, ...stripPanel.draft[date] })), note)}
              submitting={submitting}
              error={error}
              onClose={() => stripPanel.setViewingId(null)}
              onResubmit={stripPanel.viewingSubmission ? () => stripPanel.startResubmit(stripPanel.viewingSubmission!) : undefined}
              onCancel={stripPanel.viewingSubmission ? () => stripPanel.handleCancel(stripPanel.viewingSubmission!.id) : undefined}
              cancelling={!!stripPanel.viewingSubmission && cancellingId === stripPanel.viewingSubmission.id}
              onRemoveSubmissionDate={
                stripPanel.viewingSubmission ? (date) => handleRemoveDate(stripPanel.viewingSubmission!.id, date) : undefined
              }
              removingDateKey={removingDateKey}
              onDeleteSubmission={
                stripPanel.viewingSubmission ? () => stripPanel.handleDeleteSubmission(stripPanel.viewingSubmission!.id) : undefined
              }
              deleting={!!stripPanel.viewingSubmission && deletingSubmissionId === stripPanel.viewingSubmission.id}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => stripPanel.handleDayClick(todayKey)}
            className="btn-primary w-full text-sm py-2.5 mt-3"
          >
            Add availability
          </button>
        )}

        {calendarOpen && (
          <div className="mt-3.5 pt-3.5 border-t border-border">
            {loadState === "loading" && (
              <div className="h-64 rounded-xl border border-border bg-surface animate-pulse" />
            )}
            {loadState === "error" && (
              <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
                Unable to load your availability. Please try again or contact HR.
              </div>
            )}
            {/* CB, Sept 2026: "I don't want it to take over... even if it's a little bit
                shorter... I still want to be able to see the month and the days." A fixed,
                modest, self-scrolling panel rather than claiming the rest of the page's height —
                the month grid and day-tap popup all still work exactly as before, just inside a
                bounded box. */}
            {loadState === "ready" && (
              <div
                className="rounded-2xl border border-border bg-surface p-3 overflow-y-auto"
                style={{ maxHeight: "28rem" }}
              >
                <AvailabilityCalendar
                  controls={{
                    employeeId,
                    submissions,
                    onSubmit: handleSubmit,
                    submitting,
                    error,
                    onCancel: handleCancel,
                    cancellingId,
                    onRemoveDate: handleRemoveDate,
                    removingDateKey,
                    onDeleteSubmission: handleDeleteSubmission,
                    deletingSubmissionId,
                    onSubmitTimeOff: handleSubmitTimeOff,
                    submittingTimeOff,
                    timeOffError,
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* "Your submissions" — the same colored-card list CB already approved on
          MyAvailabilityPreview, now always shown here instead of behind a collapsed count.
          Redesign follow-up (Sept 2026), CB: "I don't know who is that for... I don't know who
          it's coming from" — this list is always the SIGNED-IN person's own submissions (GET
          /api/availability defaults to the caller; see that route's own doc comment), the same
          way My Time only ever shows your own hours. There's no page here that mixes in a
          teammate's — Team → Availability is the admin-facing one for that. This line makes that
          explicit instead of assuming it's obvious. */}
      {loadState === "ready" && (
        <div className="mb-4 md:shrink-0">
          <h2 className="text-sm font-semibold mb-0.5">
            Your submissions <span className="text-muted font-normal">({submissions.length})</span>
          </h2>
          <p className="text-xs text-muted mb-2">
            Your own submitted availability — teammates&apos; is under Team → Availability.
          </p>
          <MyAvailabilityPreview title="Your submissions" showLink={false} showHeading={false} />
        </div>
      )}

      {/* Two compact stat tiles — each opens its own full detail section below (corrections,
          swipe-to-delete, per-request messaging all still exactly what they were, just reached
          from a real number instead of a blind label). */}
      <div className="mb-4 md:shrink-0 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setLoggedHoursOpen((v) => !v)}
          className="text-left rounded-2xl border border-border bg-surface p-4"
        >
          <p className="text-sm font-medium text-muted">Logged hours</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">
            {weeklyMinutes === null ? "—" : (weeklyMinutes / 60).toFixed(1)}
          </p>
          <p className="text-xs text-muted mt-0.5">this pay period</p>
        </button>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <button type="button" onClick={() => setTimeOffOpen((v) => !v)} className="text-left w-full">
            <p className="text-sm font-medium text-muted">Time off</p>
            <p className="text-2xl font-bold mt-1 tabular-nums">{upcomingPtoCount ?? "—"}</p>
            <p className="text-xs text-muted mt-0.5">upcoming requests</p>
          </button>
          <button
            type="button"
            onClick={() => setTimeOffOpen(true)}
            className="text-xs font-medium text-accent-ink hover:underline mt-1.5"
          >
            Request time off
          </button>
        </div>
      </div>

      {loggedHoursOpen && (
        <div className="mb-4 md:shrink-0 md:max-h-80 md:overflow-y-auto">
          <LoggedHoursSection showHeading={false} />
        </div>
      )}

      {timeOffOpen && (
        <div className="mb-4 md:shrink-0 md:max-h-80 md:overflow-y-auto">
          <TimeOffRequests employeeId={employeeId} refreshSignal={ptoRefreshSignal} showHeading={false} />
        </div>
      )}
    </div>
  );
}
