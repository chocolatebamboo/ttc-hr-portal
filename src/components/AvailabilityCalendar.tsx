"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import { todayDateKey } from "@/lib/time";
import { getMonth, type Month } from "@/lib/month";
import type { AvailabilityDTO, AvailabilitySlot } from "@/types";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/** Same 6-month planning window as My Time (src/components/TimesheetCalendar.tsx) — CB asked
 *  for the same calendar experience, so this reuses the same horizon rather than inventing a
 *  different one. */
const MAX_FUTURE_OFFSET = 6;

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

// Same solid-fill status colors AvailabilityStatusPill uses, as a full-cell background — an
// availability submission replaces the plain day cell entirely, the same way a PTO request
// replaces the hours readout on My Time's calendar.
const STATUS_CHIP: Record<AvailabilityDTO["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  DENIED: "bg-rose-100 text-rose-800",
};

/** Every calendar date covered by any of this person's submissions, newest-first so an
 *  overlapping resubmission (a Denied one and a later Pending one for the same date, say)
 *  shows the most recent — `submissions` is expected pre-sorted newest-first, exactly what
 *  GET /api/availability already returns. */
function submissionsByDate(submissions: AvailabilityDTO[]): Map<string, AvailabilityDTO> {
  const map = new Map<string, AvailabilityDTO>();
  for (const s of submissions) {
    for (const slot of s.slots) {
      if (!map.has(slot.date)) map.set(slot.date, s);
    }
  }
  return map;
}

export interface AvailabilityCalendarControls {
  /** The signed-in team member's own submissions — newest first. This calendar is always
   *  self-service (submit your own availability); a supervisor/HR reviewing someone else's
   *  submissions uses a plain list instead (TeamAvailabilitySection, AvailabilityAdminView),
   *  same as PTO review already does — this component doesn't need a read-only mode. */
  submissions: AvailabilityDTO[];
  onSubmit: (slots: AvailabilitySlot[], note?: string) => void;
  submitting: boolean;
  error?: string;
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
 */
export default function AvailabilityCalendar({ controls }: { controls: AvailabilityCalendarControls }) {
  const { submissions } = controls;

  const [months] = useState<Month[]>(() =>
    Array.from({ length: MAX_FUTURE_OFFSET + 1 }, (_, i) => getMonth(MAX_FUTURE_OFFSET - i))
  );
  const currentMonthRef = useRef<HTMLDivElement | null>(null);
  // Tracks whichever requestAnimationFrame is pending from the scroll effect below, so its
  // cleanup can cancel a not-yet-fired one on unmount instead of leaking it.
  const rafRef = useRef<number | null>(null);

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
  useLayoutEffect(() => {
    function scrollToCurrentMonth() {
      currentMonthRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    }
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
    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
      <div className="flex-1 min-w-0 space-y-6">
        <p className="text-center text-xs text-muted/60 py-2">
          Tap the dates you&apos;re available — you can plan up to {MAX_FUTURE_OFFSET} months ahead.
        </p>
        {months.map((month, i) => {
          const offset = MAX_FUTURE_OFFSET - i;
          return (
            <div key={month.start} ref={offset === 0 ? currentMonthRef : undefined}>
              <MonthSection month={month} byDate={byDate} draft={draft} today={today} onDayClick={handleDayClick} />
            </div>
          );
        })}
        <p className="text-center text-xs text-muted/60 py-2">That&apos;s as far as planning goes for now.</p>
      </div>

      {showPanel && (
        <Panel
          key={viewingSubmission?.id ?? "draft"}
          viewingSubmission={viewingSubmission}
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
          onSubmit={(note) => controls.onSubmit(draftDates.map((date) => ({ date, ...draft[date] })), note)}
          submitting={controls.submitting}
          error={controls.error}
          onClose={() => setViewingId(null)}
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
                  className={`relative h-14 sm:h-20 rounded-xl p-2 flex flex-col items-start justify-between text-left transition-colors disabled:opacity-40 scroll-mb-[calc(50vh+112px)] sm:scroll-mb-0 ${
                    isDraft
                      ? "bg-accent-ink text-white"
                      : submission
                        ? STATUS_CHIP[submission.status]
                        : day.isToday
                          ? "bg-accent-ink/10 hover:bg-accent-ink/15"
                          : "bg-black/[0.035] hover:bg-black/[0.06]"
                  }`}
                >
                  <span className="text-xs tabular-nums">{dayNumber}</span>
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
  draftDates,
  draft,
  onUpdateTime,
  onRemoveDate,
  onClearDraft,
  onSubmit,
  submitting,
  error,
  onClose,
}: {
  viewingSubmission: AvailabilityDTO | undefined;
  draftDates: string[];
  draft: Record<string, { startTime: string; endTime: string }>;
  onUpdateTime: (dateKey: string, field: "startTime" | "endTime", value: string) => void;
  onRemoveDate: (dateKey: string) => void;
  onClearDraft: () => void;
  onSubmit: (note?: string) => void;
  submitting: boolean;
  error?: string;
  onClose: () => void;
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
      className="fixed z-50 bg-neutral-900 text-white shadow-2xl overflow-y-auto p-4
        inset-x-3 bottom-24 max-h-[50vh] rounded-3xl
        sm:sticky sm:top-4 sm:inset-auto sm:z-auto sm:max-h-none sm:w-[320px] sm:shrink-0 sm:rounded-2xl"
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
        <SubmissionDetail submission={viewingSubmission} />
      ) : (
        <DraftForm
          draftDates={draftDates}
          draft={draft}
          onUpdateTime={onUpdateTime}
          onRemoveDate={onRemoveDate}
          onSubmit={onSubmit}
          submitting={submitting}
          error={error}
        />
      )}
    </div>
  );
}

function SubmissionDetail({ submission }: { submission: AvailabilityDTO }) {
  const lines = [...submission.slots].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs text-white/50 uppercase tracking-wide">Dates & times</p>
          <AvailabilityStatusPill status={submission.status} />
        </div>
        <ul className="text-sm space-y-1">
          {lines.map((s) => (
            <li key={s.date}>
              {formatSlotDate(s.date)}: {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
            </li>
          ))}
        </ul>
        {submission.note && <p className="text-sm text-white/70 mt-2">&ldquo;{submission.note}&rdquo;</p>}
        {submission.status === "DENIED" && submission.reviewComment && (
          <p className="text-sm text-rose-300 mt-2">Denied: {submission.reviewComment}</p>
        )}
      </div>

      {submission.status === "PENDING" && <p className="text-sm text-white/60">Waiting on a supervisor or HR to approve.</p>}
    </div>
  );
}

function DraftForm({
  draftDates,
  draft,
  onUpdateTime,
  onRemoveDate,
  onSubmit,
  submitting,
  error,
}: {
  draftDates: string[];
  draft: Record<string, { startTime: string; endTime: string }>;
  onUpdateTime: (dateKey: string, field: "startTime" | "endTime", value: string) => void;
  onRemoveDate: (dateKey: string) => void;
  onSubmit: (note?: string) => void;
  submitting: boolean;
  error?: string;
}) {
  const [note, setNote] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-sm text-white/60">
        Set a time for each date, then submit them together for approval.
      </p>

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
