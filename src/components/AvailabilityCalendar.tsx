"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import JumpToTodayButton from "@/components/JumpToTodayButton";
import TeamNotesThread from "@/components/TeamNotesThread";
import MyDateTasksPanel from "@/components/MyDateTasksPanel";
import SwipeReveal from "@/components/SwipeReveal";
import { ChatIcon, ChecklistIcon, ChevronDownIcon, TrashIcon } from "@/components/icons";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import { todayDateKey, PTO_TYPE_LABEL } from "@/lib/time";
import { getMonth, type Month } from "@/lib/month";
import type { AvailabilityDTO, AvailabilitySlot, PtoType, TeamNoteTopicCountDTO } from "@/types";

// Same four options TimeOffRequests' own standalone form offers (src/components/
// TimeOffRequests.tsx) — small enough that duplicating it here beats exporting/importing it
// across components for one four-item array; it's the exact same PtoType union either way.
const PTO_TYPE_OPTIONS: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/** Same 6-month planning window as My Time (src/components/TimesheetCalendar.tsx) — CB asked
 *  for the same calendar experience, so this reuses the same horizon rather than inventing a
 *  different one. */
const MAX_FUTURE_OFFSET = 6;

/** How far back this calendar shows history — CB, Sept 2026, restructuring this page's layout:
 *  "The user should still have flexibility to scroll backward and view or select previous
 *  dates... Do not remove access to past dates unless there is already a business rule
 *  preventing selection." There wasn't one before this — the calendar simply never rendered
 *  any past month at all. Same -3 window and reasoning as My Time's EARLIEST_OFFSET (TTC's
 *  history on this system doesn't go back further than a few months), but eagerly loaded here
 *  rather than lazily paginated: unlike My Time's per-month time-entry fetches, every
 *  submission is already loaded upfront by listMyAvailability, so there's no fetch to defer. */
const PAST_OFFSET = -3;

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

// Same solid-fill status colors AvailabilityStatusPill uses, as a full-cell background — an
// availability submission replaces the plain day cell entirely, the same way a PTO request
// replaces the hours readout on My Time's calendar. CANCELLED is included only to keep this a
// complete Record<AvailabilityDTO["status"], ...> — submissionsByDate below skips Cancelled
// submissions entirely, so this entry is never actually looked up.
// ADJUSTMENT_REQUESTED (Phase 2, client spec, Sept 2026): same amber "needs a decision" tone as
// Pending — see AvailabilityStatusPill's own STYLE map, which this mirrors.
const STATUS_CHIP: Record<AvailabilityDTO["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  DENIED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-black/5 text-muted",
  ADJUSTMENT_REQUESTED: "bg-amber-100 text-amber-800",
};

/** Every calendar date covered by any of this person's submissions, newest-first so an
 *  overlapping resubmission (a Denied one and a later Pending one for the same date, say)
 *  shows the most recent — `submissions` is expected pre-sorted newest-first, exactly what
 *  GET /api/availability already returns. Cancelled submissions are skipped outright: clearing
 *  one (CB, Sept 2026: "they shouldn't just be set in stone") should free that date up for a
 *  brand-new submission immediately, same as My Time's ptoByDate skipping Cancelled PTO
 *  requests. */
function submissionsByDate(submissions: AvailabilityDTO[]): Map<string, AvailabilityDTO> {
  const map = new Map<string, AvailabilityDTO>();
  for (const s of submissions) {
    if (s.status === "CANCELLED") continue;
    for (const slot of s.slots) {
      if (!map.has(slot.date)) map.set(slot.date, s);
    }
  }
  return map;
}

export interface AvailabilityCalendarControls {
  /** The signed-in team member's own id — this calendar is always self-service, so it's both
   *  the employeeId and the viewerId every per-date TeamNotesThread needs (CB, Sept 2026: "I
   *  don't see where Sean could see those messages" — this is the fix, the same per-date
   *  conversation admin cards already open, now reachable from the employee's own side). */
  employeeId: string;
  /** The signed-in team member's own submissions — newest first. This calendar is always
   *  self-service (submit your own availability); a supervisor/HR reviewing someone else's
   *  submissions uses a plain list instead (TeamAvailabilitySection, AvailabilityAdminView),
   *  same as PTO review already does — this component doesn't need a read-only mode. */
  submissions: AvailabilityDTO[];
  onSubmit: (slots: AvailabilitySlot[], note?: string) => void;
  submitting: boolean;
  error?: string;
  /** Clearing (cancelling) one of the signed-in team member's own Pending or Denied
   *  submissions — see cancelAvailabilitySubmission's doc comment in src/lib/availability.ts
   *  for why Approved submissions aren't included. */
  onCancel: (submissionId: string) => void;
  /** Which submission (if any) a clear request is currently in flight for, so its button can
   *  show a busy state without a whole separate loading flag. */
  cancellingId: string | null;
  /** Removing ONE date out of a multi-date submission, leaving the rest of it untouched — CB,
   *  Sept 2026: "if I click on one of the dates and I say clear... it deletes all of them that
   *  I selected. It should only be one at a time." Same Pending/Denied-only eligibility as
   *  onCancel (see removeAvailabilityDate's doc comment in src/lib/availability.ts);
   *  onCancel/"Clear this submission" is still there for when clearing the whole batch at once
   *  really is what's wanted. */
  onRemoveDate: (submissionId: string, date: string) => void;
  /** "submissionId:date" of whichever single-date removal is currently in flight, so only that
   *  one row's own button shows a busy state. */
  removingDateKey: string | null;
  /** CB, Sept 2026: "we should be able to remove the whole thing entirely if we wanted to" —
   *  confirmed scope: still cancel first (keeps the record of what was offered and withdrawn,
   *  same reasoning cancelAvailabilitySubmission's doc comment already gives), but a genuinely
   *  permanent delete is now reachable right here once it's Cancelled, instead of only from the
   *  separate Your Submissions list. See deleteAvailabilitySubmission's doc comment in
   *  src/lib/availability.ts for why this stays Cancelled-only. */
  onDeleteSubmission: (submissionId: string) => void;
  /** Which submission (if any) a permanent delete is currently in flight for. */
  deletingSubmissionId: string | null;
  /** CB, Sept 2026, after the first version just handed the tapped dates off to a separate
   *  section below the calendar: "it needs to live within that pop up" — submits a time-off
   *  request without ever leaving the date-tap popup. Same underlying POST /api/pto/requests
   *  the shared TimeOffRequests widget uses; AvailabilityView owns the actual fetch (and
   *  refreshes the Time Off list below so the new request shows up there too, without this
   *  component needing to know anything about that list). Resolves true on success, so this
   *  component knows to clear its draft and close the popup; false leaves the popup and
   *  whatever was typed exactly as it was, so a validation error or network hiccup never loses
   *  anything. */
  onSubmitTimeOff: (dates: string[], values: { type: PtoType; hours: number; reason?: string }) => Promise<boolean>;
  submittingTimeOff: boolean;
  timeOffError?: string;
}

/**
 * "Availability" (CB, Sept 2026, after seeing the first standing-weekly-pattern version):
 * wants the same tap-a-date, Airbnb-style calendar experience as My Time, not a fixed Sun–Sat
 * template — "there's not a one set schedule... it's kind of on a week to week basis... the
 * members just let us know when they're available, and then we will approve it so that we
 * have a record on our side." Deliberately a NEW component rather than a rework of
 * TimesheetCalendar — that component is deeply tied to time entries and PTO date-range
 * selection, where this needs an open-ended, non-contiguous multi-date selection instead. It
 * mirrors TimesheetCalendar's visual language and scroll behavior on purpose (continuous
 * month list landing on today, non-blocking docked/floating day panel) so the two calendars
 * feel like one family, per CB's Airbnb-host-calendar reference.
 *
 * Tapping a date with no submission (today or later) toggles it into a draft selection — you
 * can tap several, non-consecutive dates before submitting them together as one record. Each
 * drafted date gets its own start/end time in the panel. Tapping a date that's already part of
 * a submission instead opens that submission's detail (read-only — approving/denying happens
 * from TeamAvailabilitySection/AvailabilityAdminView, not here) — the draft in progress, if
 * any, isn't lost; closing that detail panel returns to it.
 *
 * Renders past-to-future top-to-bottom (CB, Sept 2026, restructuring this page's layout: "When
 * somebody opens Availability on September 6, 2026, September should be the main starting
 * point. From there they scroll down into October, November, December, etc. and can scroll up
 * to August, July, etc.") — deliberately the OPPOSITE order from how this component originally
 * shipped (future above, current month as the last item, no past at all), and also the opposite
 * of My Time's own calendar, which intentionally keeps "scroll up for future, down for past."
 * Left My Time as-is since this request was specifically about Availability's layout; the two
 * calendars no longer share a scroll direction, but they never shared past-month behavior
 * either (My Time paginates lazily; this one loads its whole ±window eagerly).
 *
 * The three-region desktop layout below (fixed nav/header from the portal shell, a calendar
 * column with its own independent overflow-y-auto, and a non-scrolling detail panel beside it)
 * replaces an earlier version that relied on `position: sticky` to keep the panel in place
 * while the month list scrolled past it underneath. CB, after that still looked wrong: "Do not
 * solve this with one giant sticky container... if position: sticky is currently failing
 * because an ancestor has overflow, transform, or an unconstrained height, restructure the
 * layout rather than simply adding more position: sticky rules." Sticky positioning ties a
 * panel's position to whatever ancestor happens to scroll, which is exactly the kind of
 * containment-chain fragility that caused the sidebar-blank bug in (portal)/layout.tsx — this
 * uses the same fix here (an explicit md:min-h-0 height chain, md: to match the portal shell's
 * own desktop breakpoint) so the calendar column is the ONLY thing that scrolls, and the panel
 * is a normal, independently-sized flex sibling that simply never moves, with its own
 * overflow-y-auto only for when its own content (many selected dates) is taller than it.
 *
 * A DENIED submission's detail isn't a dead end (CB, Sept 2026: "it's like it's not giving you
 * the option to even adjust... almost like a permanent statement") — its "Submit different
 * times" button drops the same dates back into `draft`, pre-filled with the denied times so
 * there's something to start from, so the person can adjust and resend rather than being stuck
 * forever on a date they can never touch again. `submissionsByDate` already resolves a date to
 * whichever submission covering it is newest, precisely so a later resubmission naturally
 * supersedes the denied one it replaced — this button was the only piece missing.
 *
 * Neither a Pending nor a Denied submission is permanent, full stop (CB, Sept 2026: "I should
 * be able to clear the dates that either I got denied or the dates that I... said I was
 * available... they shouldn't just be set in stone") — a "Clear this submission" button sets it
 * to Cancelled, which `submissionsByDate` skips entirely, so the date goes right back to being
 * a plain, selectable one. Left out for Approved: once a supervisor's signed off, that's not
 * something the employee unwinds unilaterally, same stance PTO already takes on its own
 * Cancel button.
 */
export default function AvailabilityCalendar({ controls }: { controls: AvailabilityCalendarControls }) {
  const { submissions, employeeId } = controls;

  // Per-date message counts for this person's own conversations, keyed "submissionId:date" —
  // fetched once here (rather than inside SubmissionDetail, which remounts every time a
  // different submission is viewed thanks to Panel's key prop below) so switching between
  // submissions doesn't re-fetch on every click. Best-effort: a missing badge isn't worth
  // failing the calendar over.
  const [messageCounts, setMessageCounts] = useState<Map<string, number>>(new Map());
  async function loadCounts() {
    try {
      const res = await fetch(`/api/team-notes/${employeeId}/topic-counts`);
      if (!res.ok) return;
      const data: { counts: TeamNoteTopicCountDTO[] } = await res.json();
      const map = new Map<string, number>();
      for (const c of data.counts) {
        if (c.topicType !== "AVAILABILITY_DATE") continue;
        map.set(`${c.topicId}:${c.topicDate ?? ""}`, c.total);
      }
      setMessageCounts(map);
    } catch {
      // ignored — see comment above
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  // Ascending offset order (PAST_OFFSET .. MAX_FUTURE_OFFSET) so the array is already in
  // top-to-bottom render order with no reordering logic needed — past months first, current
  // month in the middle, future months last. See this component's doc comment above for why
  // this is the opposite of My Time's own month ordering.
  const [months] = useState<Month[]>(() =>
    Array.from({ length: MAX_FUTURE_OFFSET - PAST_OFFSET + 1 }, (_, i) => getMonth(PAST_OFFSET + i))
  );
  const currentMonthRef = useRef<HTMLDivElement | null>(null);
  // Tracks whichever requestAnimationFrame is pending from the scroll effect below, so its
  // cleanup can cancel a not-yet-fired one on unmount instead of leaking it.
  const rafRef = useRef<number | null>(null);

  // CB, round five (pointing at an Airbnb-style host calendar reference video): "it auto
  // updates with the... respective date or month at the top" while scrolling — a sticky header
  // (rendered below, just above the month list) that always names whichever month is currently
  // scrolled to the top of view, the same way that reference calendar's own header behaves.
  // Every month wrapper below registers itself here by its own `month.start` key so the
  // IntersectionObserver effect can watch all of them at once, not just the current one.
  const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [currentLabel, setCurrentLabel] = useState(() => getMonth(0).label);

  useEffect(() => {
    // A thin horizontal band near the very top of the viewport — rootMargin's negative top
    // pushes it down past the sticky header's own height, and the large negative bottom keeps
    // it thin, so "which month is intersecting this band" reads as "which month is scrolled to
    // the top" rather than "which month is merely anywhere on screen." root: null (the
    // viewport) works correctly here even for the desktop layout's own internally-scrolling
    // column — a target's bounding rect already reflects any scrollable ancestor's scroll
    // offset, so intersection with the viewport still tracks scroll position inside that column.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((best, e) => (e.boundingClientRect.top < best.boundingClientRect.top ? e : best));
        const label = topMost.target.getAttribute("data-month-label");
        if (label) setCurrentLabel(label);
      },
      { rootMargin: "-8px 0px -82% 0px", threshold: 0 }
    );
    monthRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [months]);

  // Same "land on today" behavior as TimesheetCalendar, including the same fix for the same
  // real bug: Next.js's own App Router scroll-restoration runs its scroll-to-top AFTER this
  // component's own mount effect (a parent's plain useEffect can still undo a child's
  // useLayoutEffect on the very same navigation, since passive effects across the whole tree
  // commit after every layout effect has), so a plain mount-time scrollIntoView isn't reliably
  // the last word. The two rAF callbacks re-assert the same scroll a couple of frames later,
  // after the browser has actually painted — by then every effect from this commit (ours and
  // the router's) has run, so nothing scrolls out from under it again. pageshow/
  // visibilitychange separately cover the PWA-background/bfcache-reopen case, where this
  // component never remounts at all.
  // Hoisted out of the effect below (rather than a local function inside it) so the
  // JumpToTodayButton's onClick can reuse the exact same scroll call.
  function scrollToCurrentMonth() {
    currentMonthRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }

  useLayoutEffect(() => {
    scrollToCurrentMonth();
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(scrollToCurrentMonth);
      rafRef.current = raf2;
    });
    rafRef.current = raf1;

    function onPageShow() {
      scrollToCurrentMonth();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") scrollToCurrentMonth();
    }
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const byDate = useMemo(() => submissionsByDate(submissions), [submissions]);
  const today = todayDateKey();

  // Dates tapped for a brand-new submission, not yet sent — keyed by date, each with its own
  // editable time range. Cleared entirely on a successful submit (see the effect below).
  const [draft, setDraft] = useState<Record<string, { startTime: string; endTime: string }>>({});
  // A single existing submission being viewed instead — takes over the panel without
  // discarding any draft still in progress underneath it.
  const [viewingId, setViewingId] = useState<string | null>(null);

  const submittedIds = useRef(new Set(submissions.map((s) => s.id)));
  useEffect(() => {
    // A submission that's now in the list but wasn't a moment ago just got created by this
    // calendar's own submit — clear the draft that produced it. Doesn't fire on every
    // `submissions` change (e.g. a supervisor deciding one elsewhere), only on growth.
    const ids = new Set(submissions.map((s) => s.id));
    if (ids.size > submittedIds.current.size) setDraft({});
    submittedIds.current = ids;
  }, [submissions]);

  // Seeds a fresh draft from a denied submission's own dates and times, then swaps the
  // read-only detail view out for the editable draft panel — see this component's doc comment
  // above for why this exists rather than leaving a denied date permanently unclickable.
  function startResubmit(submission: AvailabilityDTO) {
    setViewingId(null);
    setDraft(() =>
      Object.fromEntries(submission.slots.map((s) => [s.date, { startTime: s.startTime, endTime: s.endTime }]))
    );
  }

  // CB, Sept 2026: wanted a permanent delete reachable right after clearing, not a separate trip
  // to Your Submissions — so clearing no longer closes the panel. `submissions` still updates in
  // place (AvailabilityView's own handleCancel), so `viewingSubmission` below re-resolves to the
  // same id with its new Cancelled status, and SubmissionDetail swaps its "Clear" button for a
  // "Delete permanently" one. Tapping a calendar cell for this date now starts a fresh draft
  // instead (submissionsByDate skips Cancelled ones) — but the panel that's already open for it
  // stays open on its own until closed or actually deleted, by design.
  function handleCancel(submissionId: string) {
    controls.onCancel(submissionId);
  }

  // The real, permanent delete — only ever reachable once a submission is already Cancelled
  // (see AvailabilityCalendarControls.onDeleteSubmission's doc comment above). This DOES close
  // the panel: unlike cancelling, there's nothing left to keep showing once the row is gone.
  function handleDeleteSubmission(submissionId: string) {
    controls.onDeleteSubmission(submissionId);
    setViewingId(null);
  }

  // "Request time off instead" in the draft panel, submitted from right there — CB, Sept 2026:
  // "it needs to live within that pop up." These dates were never submitted as availability, so
  // a successful time-off submission clears the draft (there's nothing to keep them drafted
  // for) exactly the way a successful availability submit does, which is also what closes the
  // popup (showPanel below goes false once draftDates is empty). A failed submission leaves the
  // draft — and whatever was typed into the time-off form — untouched.
  async function handleSubmitTimeOff(dates: string[], values: { type: PtoType; hours: number; reason?: string }) {
    const ok = await controls.onSubmitTimeOff(dates, values);
    if (ok) setDraft({});
    return ok;
  }

  function handleDayClick(dateKey: string) {
    const existing = byDate.get(dateKey);
    if (existing) {
      setViewingId(existing.id);
      return;
    }
    if (dateKey < today) return;
    setViewingId(null);
    setDraft((d) => {
      const next = { ...d };
      if (next[dateKey]) delete next[dateKey];
      else next[dateKey] = { startTime: DEFAULT_START, endTime: DEFAULT_END };
      return next;
    });
  }

  const draftDates = Object.keys(draft).sort();
  const viewingSubmission = viewingId ? submissions.find((s) => s.id === viewingId) : undefined;
  const showPanel = draftDates.length > 0 || !!viewingSubmission;

  return (
    // md:flex-1 md:min-h-0: this row fills whatever height AvailabilityView's own md:h-full
    // wrapper hands it (itself the remaining height under the portal shell's fixed header —
    // see (portal)/layout.tsx), rather than sizing to its own content the way a plain flex row
    // would by default. That's what lets its two children below stretch to a real, bounded
    // height (the default `items-stretch` applies since nothing overrides it) instead of each
    // just being as tall as its own content — the same "give every nested flex level an actual
    // height, not just the outermost one" fix as (portal)/layout.tsx's own md:min-h-0 chain.
    // md: (not sm:) deliberately matches the portal shell's own desktop breakpoint, so this
    // fixed three-region layout only ever turns on exactly when RoleNav also switches into its
    // own fixed desktop treatment — no in-between width where one has and the other hasn't.
    <div className="flex flex-col md:flex-row md:flex-1 md:min-h-0 gap-4">
      {/* The ONLY scrollable region on desktop — md:min-h-0 is what lets md:overflow-y-auto
          actually engage instead of this column just growing to fit all ~10 months of content
          and pushing the row (and the panel beside it) taller than the viewport.
          scrollbar-hide (CB, Sept 2026, right after this became the region that actually
          scrolls instead of the whole page): "I don't want that... where the scroll bar is" —
          hides the native track/thumb only; the region still scrolls the same way (wheel,
          trackpad, touch, keyboard) either way. */}
      <div className="flex-1 min-w-0 space-y-6 md:min-h-0 md:overflow-y-auto md:pr-1 scrollbar-hide">
        {/* CB, round five: the auto-updating month header from her Airbnb-calendar reference
            video — tapping it, like that reference's own chevron, jumps straight back to today. */}
        <button
          type="button"
          onClick={scrollToCurrentMonth}
          className="sticky top-0 z-10 -mx-1 mb-1 flex items-center gap-1 bg-background/95 backdrop-blur px-1 py-2 text-left"
        >
          <span className="font-serif font-bold text-xl">{currentLabel}</span>
          <ChevronDownIcon className="h-4 w-4 text-muted" />
        </button>
        <p className="text-center text-xs text-muted/60 py-2">
          Tap the dates you're available — you can plan up to {MAX_FUTURE_OFFSET} months ahead.
        </p>
        {months.map((month, i) => {
          const offset = PAST_OFFSET + i;
          return (
            <div
              key={month.start}
              ref={(el) => {
                if (offset === 0) currentMonthRef.current = el;
                if (el) monthRefs.current.set(month.start, el);
                else monthRefs.current.delete(month.start);
              }}
              data-month-label={month.label}
            >
              <MonthSection month={month} byDate={byDate} draft={draft} today={today} onDayClick={handleDayClick} />
            </div>
          );
        })}
        <p className="text-center text-xs text-muted/60 py-2">That's as far as planning goes for now.</p>
      </div>

      {/* Same "don't get lost" affordance as My Time's calendar (CB, Sept 2026) — hidden while
          the draft/detail panel is open on a phone, since it occupies the same corner. */}
      <JumpToTodayButton targetRef={currentMonthRef} onJump={scrollToCurrentMonth} hidden={showPanel} />

      {showPanel && (
        <Panel
          key={viewingSubmission?.id ?? "draft"}
          viewingSubmission={viewingSubmission}
          employeeId={employeeId}
          messageCounts={messageCounts}
          onMessagePosted={loadCounts}
          draftDates={draftDates}
          draft={draft}
          onUpdateTime={(dateKey, field, value) => setDraft((d) => ({ ...d, [dateKey]: { ...d[dateKey], [field]: value } }))}
          onRemoveDate={(dateKey) =>
            setDraft((d) => {
              const next = { ...d };
              delete next[dateKey];
              return next;
            })
          }
          onClearDraft={() => setDraft({})}
          onSubmitTimeOff={(values) => handleSubmitTimeOff(draftDates, values)}
          submittingTimeOff={controls.submittingTimeOff}
          timeOffError={controls.timeOffError}
          onSubmit={(note) => controls.onSubmit(draftDates.map((date) => ({ date, ...draft[date] })), note)}
          submitting={controls.submitting}
          error={controls.error}
          onClose={() => setViewingId(null)}
          onResubmit={viewingSubmission ? () => startResubmit(viewingSubmission) : undefined}
          onCancel={viewingSubmission ? () => handleCancel(viewingSubmission.id) : undefined}
          cancelling={!!viewingSubmission && controls.cancellingId === viewingSubmission.id}
          onRemoveSubmissionDate={viewingSubmission ? (date) => controls.onRemoveDate(viewingSubmission.id, date) : undefined}
          removingDateKey={controls.removingDateKey}
          onDeleteSubmission={viewingSubmission ? () => handleDeleteSubmission(viewingSubmission.id) : undefined}
          deleting={!!viewingSubmission && controls.deletingSubmissionId === viewingSubmission.id}
        />
      )}
    </div>
  );
}

function MonthSection({
  month,
  byDate,
  draft,
  today,
  onDayClick,
}: {
  month: Month;
  byDate: Map<string, AvailabilityDTO>;
  draft: Record<string, { startTime: string; endTime: string }>;
  today: string;
  onDayClick: (dateKey: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-serif font-semibold text-lg">{month.label}</h2>
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
              const dayNumber = Number(day.date.slice(8, 10));

              if (!day.inMonth) {
                return (
                  <div key={day.date} className="h-14 sm:h-20 rounded-lg flex items-start justify-start p-2">
                    <span className="text-xs text-muted/30 tabular-nums">{dayNumber}</span>
                  </div>
                );
              }

              const submission = byDate.get(day.date);
              const isDraft = !submission && !!draft[day.date];
              const clickable = !!submission || day.date >= today;

              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={(e) => {
                    onDayClick(day.date);
                    // Same reasoning as My Time's own day buttons — clear the panel's own
                    // footprint out of scrollIntoView's idea of "visible" so the just-tapped
                    // date never ends up hidden under the panel that's about to appear.
                    e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
                  disabled={!clickable}
                  // Same uniform light-gray-square treatment as My Time's calendar (CB, Sept
                  // 2026, pointing at the Airbnb host calendar again: "the rounded squares...
                  // a light gray... the spacing" — every day the same fill, today included;
                  // today is marked by the small solid badge on the day number below instead).
                  // Fill bumped from bg-black/[0.035] to bg-black/[0.07] (hover [0.12]) — CB
                  // flagged the original as reading as plain white against the white card
                  // behind it rather than a visible light gray like the reference.
                  className={`relative h-14 sm:h-20 rounded-xl p-2 flex flex-col items-start justify-between text-left transition-colors disabled:opacity-40 scroll-mb-[calc(75vh+112px)] md:scroll-mb-0 ${
                    isDraft
                      ? "bg-accent-ink text-white"
                      : submission
                        ? STATUS_CHIP[submission.status]
                        : "bg-black/[0.07] hover:bg-black/[0.12]"
                  }`}
                >
                  {day.isToday ? (
                    // Today and Selected are two different states (CB, Sept 2026: "I would keep
                    // a dedicated Today treatment separate from Selected... If today is
                    // selected, use the selected styling while still making it clear that it
                    // represents today") — solid when the cell's own background is still plain
                    // gray (nothing to contrast against but the cell itself), outlined once the
                    // cell is already filled solid accent-ink by being drafted/selected (a solid
                    // same-color badge would simply vanish against it).
                    <span
                      className={`flex items-center justify-center h-5 w-5 rounded-full text-xs font-semibold tabular-nums ${
                        isDraft ? "border-2 border-white text-white" : "bg-accent-ink text-white"
                      }`}
                    >
                      {dayNumber}
                    </span>
                  ) : (
                    <span className="text-xs tabular-nums">{dayNumber}</span>
                  )}
                  {submission && !isDraft && (
                    <span className="text-[10px] sm:text-xs font-semibold leading-tight">
                      {formatTime12h(submission.slots.find((s) => s.date === day.date)?.startTime ?? "")}
                    </span>
                  )}
                  {isDraft && <span className="text-[10px] sm:text-xs font-semibold">Selected</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
function Panel({
  viewingSubmission,
  employeeId,
  messageCounts,
  onMessagePosted,
  draftDates,
  draft,
  onUpdateTime,
  onRemoveDate,
  onClearDraft,
  onSubmitTimeOff,
  submittingTimeOff,
  timeOffError,
  onSubmit,
  submitting,
  error,
  onClose,
  onResubmit,
  onCancel,
  cancelling,
  onRemoveSubmissionDate,
  removingDateKey,
  onDeleteSubmission,
  deleting,
}: {
  viewingSubmission: AvailabilityDTO | undefined;
  employeeId: string;
  messageCounts: Map<string, number>;
  onMessagePosted: () => void;
  draftDates: string[];
  draft: Record<string, { startTime: string; endTime: string }>;
  onUpdateTime: (dateKey: string, field: "startTime" | "endTime", value: string) => void;
  /** Drops an undrafted date from the draft form before submit — nothing to do with the
   *  already-submitted case below. */
  onRemoveDate: (dateKey: string) => void;
  onClearDraft: () => void;
  /** "Request time off instead," submitted right there in the popup — see
   *  AvailabilityCalendarControls.onSubmitTimeOff's doc comment above. */
  onSubmitTimeOff: (values: { type: PtoType; hours: number; reason?: string }) => Promise<boolean>;
  submittingTimeOff: boolean;
  timeOffError?: string;
  onSubmit: (note?: string) => void;
  submitting: boolean;
  error?: string;
  onClose: () => void;
  onResubmit?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  /** Removes ONE date out of an already-submitted, still-Pending/Denied submission via the real
   *  DELETE route — see AvailabilityCalendarControls.onRemoveDate's doc comment above. Distinct
   *  name from the draft form's own onRemoveDate (different job entirely) to avoid a collision
   *  in this one destructure. */
  onRemoveSubmissionDate?: (date: string) => void;
  removingDateKey: string | null;
  /** The real, permanent delete — only ever passed for a submission that's already Cancelled;
   *  see AvailabilityCalendarControls.onDeleteSubmission's doc comment above. */
  onDeleteSubmission?: () => void;
  deleting?: boolean;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const headerLabel = viewingSubmission
    ? draftDates.length > 0
      ? "Submission"
      : "Submission detail"
    : draftDates.length === 1
      ? formatSlotDate(draftDates[0])
      : `${draftDates.length} dates selected`;

  return (
    <div
      // On desktop this is a normal (non-sticky, non-absolute) flex sibling of the calendar
      // column, stretched by the row's own `items-stretch` default to that row's real,
      // md:min-h-0-bounded height — so it simply never moves while the calendar scrolls next to
      // it, rather than tracking scroll position the way `sticky` does. `overflow-y-auto` (in
      // the unconditional classes below) is what gives IT an independent scrollbar if enough
      // dates are selected to make its own content taller than that fixed height — see this
      // component's doc comment above for why sticky was replaced rather than added to.
      className="fixed z-50 bg-neutral-900 text-white shadow-2xl overflow-y-auto p-4
        inset-x-3 bottom-24 max-h-[75vh] rounded-3xl
        md:static md:inset-auto md:z-auto md:h-full md:max-h-full md:min-h-0 md:w-[320px] md:shrink-0 md:rounded-2xl"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium">{headerLabel}</p>
        {viewingSubmission ? (
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-base leading-none shrink-0"
          >
            ×
          </button>
        ) : (
          <button onClick={onClearDraft} className="text-xs text-white/60 hover:text-white underline shrink-0">
            Clear
          </button>
        )}
      </div>

      {viewingSubmission ? (
        <SubmissionDetail
          submission={viewingSubmission}
          employeeId={employeeId}
          messageCounts={messageCounts}
          onMessagePosted={onMessagePosted}
          onResubmit={onResubmit}
          onCancel={onCancel}
          cancelling={cancelling}
          onRemoveDate={onRemoveSubmissionDate}
          removingDateKey={removingDateKey}
          onDelete={onDeleteSubmission}
          deleting={deleting}
        />
      ) : (
        <DraftForm
          draftDates={draftDates}
          draft={draft}
          onUpdateTime={onUpdateTime}
          onRemoveDate={onRemoveDate}
          onSubmitTimeOff={onSubmitTimeOff}
          submittingTimeOff={submittingTimeOff}
          timeOffError={timeOffError}
          onSubmit={onSubmit}
          submitting={submitting}
          error={error}
        />
      )}
    </div>
  );
}

function SubmissionDetail({
  submission,
  employeeId,
  messageCounts,
  onMessagePosted,
  onResubmit,
  onCancel,
  cancelling,
  onRemoveDate,
  removingDateKey,
  onDelete,
  deleting,
}: {
  submission: AvailabilityDTO;
  employeeId: string;
  messageCounts: Map<string, number>;
  onMessagePosted: () => void;
  onResubmit?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  /** CB, Sept 2026: "if I click on one of the dates and I say clear... it deletes all of them
   *  that I selected. It should only be one at a time" — removes just the one date this row is
   *  for, via DELETE /api/availability/[id]/dates/[date] (removeAvailabilityDate). "Clear this
   *  submission" below stays as the deliberate clear-everything-at-once action. */
  onRemoveDate?: (date: string) => void;
  removingDateKey: string | null;
  /** The real, permanent delete — only ever passed (and only ever rendered, see canDelete
   *  below) once this submission is already Cancelled. See
   *  AvailabilityCalendarControls.onDeleteSubmission's doc comment above. */
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const lines = [...submission.slots].sort((a, b) => a.date.localeCompare(b.date));
  const canClear = submission.status === "PENDING" || submission.status === "DENIED";
  const canDelete = submission.status === "CANCELLED";
  // Which date's conversation is open — local to this one submission's panel rather than lifted
  // up, since Panel remounts this component fresh (key={viewingSubmission?.id ?? "draft"})
  // every time a different submission is opened, so there's never a stale open date to carry
  // over from one submission to the next.
  const [openDate, setOpenDate] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs text-white/50 uppercase tracking-wide">Dates & times</p>
          <AvailabilityStatusPill status={submission.status} />
        </div>
        <ul className="text-sm space-y-1">
          {/* CB, Sept 2026: "I send it to Sean, I don't see where Sean could see those
              messages that I put for that specific day" — this is that missing other half.
              Tapping a date opens the exact same per-date conversation
              (topicType="AVAILABILITY_DATE") a supervisor/admin opens from their own card for
              this same submission, so a message posted from either side lands in one shared
              thread instead of two that never meet. */}
          {lines.map((s) => {
            const msgCount = messageCounts.get(`${submission.id}:${s.date}`) ?? 0;
            const active = openDate === s.date;
            const removingThisDate = removingDateKey === `${submission.id}:${s.date}`;
            const row = (
              <div
                className={`flex items-center gap-1 rounded-lg transition-colors ${active ? "bg-white/15" : "hover:bg-white/10"}`}
              >
                <button
                  type="button"
                  onClick={() => setOpenDate(active ? null : s.date)}
                  className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 text-left"
                >
                  <span>
                    {formatSlotDate(s.date)}: {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
                  </span>
                  <span className="flex items-center gap-1 shrink-0 text-xs text-white/60">
                    <ChatIcon className="h-3 w-3" />
                    {msgCount > 0 ? msgCount : "Message"}
                  </span>
                </button>
                {/* One date at a time, distinct from "Clear this submission" below (CB, Sept
                    2026 — see this component's doc comment above). */}
                {canClear && onRemoveDate && (
                  <button
                    type="button"
                    onClick={() => onRemoveDate(s.date)}
                    disabled={removingThisDate}
                    aria-label={`Remove ${formatSlotDate(s.date)}`}
                    className="h-7 w-7 mr-1 shrink-0 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-50"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
            return (
              <li key={s.date} className="-mx-2 px-2 rounded-lg">
                {/* CB, Sept 2026: "we should be able to delete it by... sliding to the left" —
                    same swipe-to-delete gesture as every other list in this app (TimeOffRequests,
                    MyAvailabilityPreview, My Time), now here too, alongside the trash-icon button
                    the row already had for anyone on a non-touch device. Only wrapped when this
                    date is actually removable — same canClear/onRemoveDate gate as the button. */}
                {canClear && onRemoveDate ? (
                  <SwipeReveal
                    actionSide="right"
                    actionLabel="Delete"
                    actionIcon={<TrashIcon className="h-4 w-4" />}
                    actionClassName="bg-rose-600 text-white rounded-lg"
                    busy={removingThisDate}
                    onAction={() => onRemoveDate(s.date)}
                  >
                    {row}
                  </SwipeReveal>
                ) : (
                  row
                )}
                {active && (
                  <div className="mt-1.5 mb-2 space-y-2">
                    {/* CB, Sept 2026: "I probably want some of the features of what was
                        approved or what was selected to reflect on the availability page" and
                        "once we create the task... they'll be able to... click a check mark" —
                        the same per-date task list a supervisor/admin already sees and pushes to
                        from their own card (TeamAvailabilityCards' DateTasksPanel), now visible
                        and markable-done from the employee's own side too, right where they're
                        already looking at this date. */}
                    <div>
                      <p className="text-xs font-semibold text-white/60 mb-1 flex items-center gap-1.5">
                        <ChecklistIcon className="h-3.5 w-3.5 text-white/60" />
                        Tasks for this date
                      </p>
                      <MyDateTasksPanel employeeId={employeeId} taskDate={s.date} />
                    </div>
                    <TeamNotesThread
                      employeeId={employeeId}
                      viewerId={employeeId}
                      topicType="AVAILABILITY_DATE"
                      topicId={submission.id}
                      topicDate={s.date}
                      placeholder="Message your supervisor or HR about this date…"
                      onMessagePosted={onMessagePosted}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {submission.note && <p className="text-sm text-white/70 mt-2">&ldquo;{submission.note}&rdquo;</p>}
        {submission.status === "DENIED" && submission.reviewComment && (
          <p className="text-sm text-rose-300 mt-2">Denied: {submission.reviewComment}</p>
        )}
      </div>

      {submission.status === "PENDING" && <p className="text-sm text-white/60">Waiting on a supervisor or HR to approve.</p>}

      {/* Phase 2 (client spec, Sept 2026): the actual Accept/Decline for a proposed new time
          lives on MyAvailabilityPreview's own card, right below this calendar on the same
          Availability page — this is just a pointer so someone landing here via a tapped date
          isn't left wondering why there's nothing to do. */}
      {submission.status === "ADJUSTMENT_REQUESTED" && (
        <p className="text-sm text-white/60">
          Your supervisor proposed a different time for this — see &ldquo;Your submissions&rdquo; above to accept or decline.
        </p>
      )}

      {/* Denied isn't final — this reopens the same dates as an editable draft, pre-filled
          with the denied times, so there's a clear next step instead of a dead end. */}
      {submission.status === "DENIED" && onResubmit && (
        <button
          type="button"
          onClick={onResubmit}
          className="w-full rounded-2xl bg-white text-neutral-900 hover:bg-white/90 py-3 text-sm font-medium"
        >
          Submit different times
        </button>
      )}

      {/* Withdraws a Pending submission, or clears a Denied one out for good instead of
          resubmitting it — either way the dates go right back to being selectable (see this
          component's doc comment above). Not offered once Approved. Label spells out "all N
          dates" when there's more than one, so it reads as the deliberate bulk action it is,
          distinct from the per-date trash icon above each line. */}
      {canClear && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="w-full rounded-2xl bg-white/10 hover:bg-white/20 disabled:opacity-50 py-3 text-sm font-medium"
        >
          {cancelling ? "Clearing…" : lines.length > 1 ? `Clear all ${lines.length} dates` : "Clear this submission"}
        </button>
      )}

      {/* CB, Sept 2026: "we should be able to remove the whole thing entirely if we wanted to.
          But that's only if... it's not fully approved" — confirmed this stays a second step
          after Clear rather than an immediate delete (same reasoning cancelAvailabilitySubmission
          already gives for keeping a Cancelled record), but now reachable right here the moment
          it's Cancelled instead of only from the separate Your Submissions list. Same
          Cancelled-only rule MyAvailabilityPreview's own delete button already enforces. */}
      {canDelete && onDelete && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-3.5 space-y-2">
          <p className="text-sm text-white/70">Cancelled. You can remove it for good, or just leave it here.</p>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="w-full rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 py-3 text-sm font-medium text-white"
          >
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      )}
    </div>
  );
}

function DraftForm({
  draftDates,
  draft,
  onUpdateTime,
  onRemoveDate,
  onSubmitTimeOff,
  submittingTimeOff,
  timeOffError,
  onSubmit,
  submitting,
  error,
}: {
  draftDates: string[];
  draft: Record<string, { startTime: string; endTime: string }>;
  onUpdateTime: (dateKey: string, field: "startTime" | "endTime", value: string) => void;
  onRemoveDate: (dateKey: string) => void;
  onSubmitTimeOff: (values: { type: PtoType; hours: number; reason?: string }) => Promise<boolean>;
  submittingTimeOff: boolean;
  timeOffError?: string;
  onSubmit: (note?: string) => void;
  submitting: boolean;
  error?: string;
}) {
  const [note, setNote] = useState("");
  // CB, Sept 2026, after the first version handed the tapped dates off to a separate section
  // below the calendar: "it needs to live within that pop up" — flips this same panel over to
  // an actual time-off request form (TimeOffInlineForm below) instead of leaving here at all.
  // "← Back to availability" returns to this draft form with nothing lost, since `draft` itself
  // is never touched while that's open.
  const [requestingTimeOff, setRequestingTimeOff] = useState(false);

  if (requestingTimeOff) {
    return (
      <TimeOffInlineForm
        dates={draftDates}
        onBack={() => setRequestingTimeOff(false)}
        onSubmit={onSubmitTimeOff}
        submitting={submittingTimeOff}
        error={timeOffError}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-white/60">
        Set a time for each date, then submit them together for approval.
      </p>

      {/* CB, Sept 2026: "I need to have options within the view of when they click on a date
          and that pop up comes up, we need the options to see and make time off if needed" —
          not every tapped date is about being AVAILABLE to work; some are the opposite. Flips
          this same panel over to TimeOffInlineForm below rather than leaving this popup at all
          (CB's follow-up: "it needs to live within that pop up"). */}
      <button
        type="button"
        onClick={() => setRequestingTimeOff(true)}
        className="w-full flex items-center justify-between gap-2 rounded-2xl bg-white/5 hover:bg-white/10 px-4 py-3 text-left transition-colors"
      >
        <span className="text-sm">
          Need {draftDates.length === 1 ? "this day" : "these days"} off instead?
        </span>
        <span className="text-xs font-medium text-white/70 shrink-0">Request time off →</span>
      </button>

      <div className="space-y-2">
        {draftDates.map((dateKey) => {
          const row = draft[dateKey];
          return (
            <div key={dateKey} className="rounded-2xl bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-medium">{formatSlotDate(dateKey)}</p>
                <button
                  type="button"
                  onClick={() => onRemoveDate(dateKey)}
                  aria-label={`Remove ${dateKey}`}
                  className="h-6 w-6 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-sm leading-none"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={row.startTime}
                  onChange={(e) => onUpdateTime(dateKey, "startTime", e.target.value)}
                  className="rounded-md bg-white/10 border border-white/10 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-white/30"
                />
                <span className="text-sm text-white/50">to</span>
                <input
                  type="time"
                  value={row.endTime}
                  onChange={(e) => onUpdateTime(dateKey, "endTime", e.target.value)}
                  className="rounded-md bg-white/10 border border-white/10 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-white/5 p-4">
        <label className="block text-xs text-white/50 mb-1">Note (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-white/30"
          placeholder="Add a note for your supervisor"
        />
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <button
        type="button"
        onClick={() => onSubmit(note.trim() || undefined)}
        disabled={submitting || draftDates.length === 0}
        className="w-full rounded-2xl bg-white text-neutral-900 hover:bg-white/90 disabled:opacity-50 py-3 text-sm font-medium"
      >
        {submitting ? "Submitting…" : `Submit ${draftDates.length === 1 ? "this date" : "these dates"} for approval`}
      </button>
    </div>
  );
}

/**
 * The actual time-off request — CB, Sept 2026: "it needs to live within that pop up," not hand
 * the tapped dates off to a separate section elsewhere on the page. Same three fields
 * StandalonePtoForm (src/components/TimeOffRequests.tsx) asks for on a plain "Request time
 * off" — type, hours, an optional reason — just without its own date pickers, since the dates
 * here are already fixed to whatever's currently drafted on the calendar above. Submitting
 * posts straight through AvailabilityCalendarControls.onSubmitTimeOff, which AvailabilityView
 * turns into the same POST /api/pto/requests call the shared widget itself makes.
 */
function TimeOffInlineForm({
  dates,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  dates: string[];
  onBack: () => void;
  onSubmit: (values: { type: PtoType; hours: number; reason?: string }) => Promise<boolean>;
  submitting: boolean;
  error?: string;
}) {
  const [type, setType] = useState<PtoType>("VACATION");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");

  const sorted = [...dates].sort();
  const rangeLabel =
    sorted.length === 1 ? formatSlotDate(sorted[0]) : `${formatSlotDate(sorted[0])} – ${formatSlotDate(sorted[sorted.length - 1])}`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ type, hours: Number(hours), reason: reason.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <button type="button" onClick={onBack} className="text-xs text-white/60 hover:text-white underline">
        ← Back to availability
      </button>

      <p className="text-sm text-white/60">Requesting time off for {rangeLabel}.</p>

      <div className="rounded-2xl bg-white/5 p-4 space-y-3">
        <div>
          <label className="block text-xs text-white/50 mb-1">Type of leave</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PtoType)}
            className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
          >
            {PTO_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {PTO_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Number of hours</label>
          <input
            type="number"
            required
            min="0.5"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 8"
            className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
          />
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Reason / comment (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/30"
          />
        </div>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-2xl bg-white text-neutral-900 hover:bg-white/90 disabled:opacity-50 py-3 text-sm font-medium"
      >
        {submitting ? "Submitting…" : "Submit time-off request"}
      </button>
    </form>
  );
}
