"use client";

import { useEffect, useRef, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import { ChecklistIcon, ChevronDownIcon } from "@/components/icons";
import { formatSlotDate } from "@/lib/availability-format";
import { getWeek, formatWeekRange, weekOffsetForDate } from "@/lib/week";

type LoadState = "loading" | "ready" | "error";

/** Same priority DateTaskRow's own canTapComplete cares about — needs-attention first (new, or
 *  just sent back and needs to be redone), then already-in-motion (started, or already turned in
 *  and waiting on a reviewer), approved last. Applied within one date inside the current week,
 *  not across the whole page. */
function priorityRank(t: DateTaskDTO): number {
  if (t.status === "ASSIGNED" || t.status === "RETURNED") return 0;
  if (t.status === "IN_PROGRESS" || t.status === "AWAITING_REVIEW") return 1;
  return 2;
}

/**
 * CB, Oct 2026: "there should be like a task page so you can see all your tasks... I want to see
 * it cleanly." Until now a team member's tasks only ever showed up scattered one date at a time
 * (MyDateTasksPanel, on that date's Availability/Schedule card) or folded into the dashboard's
 * "Your tasks" section (DateTasksSection, which drops anything already Approved). This page
 * gathers every task assigned to you in one place.
 *
 * Reuses the same `/api/date-tasks/{employeeId}` route and DateTaskRow card the existing
 * per-date panels already used (no new backend needed — see listDateTasks's self-access rule in
 * src/lib/date-tasks.ts).
 *
 * Oct 2026, round two (CB, on the original all-dates-stacked version: "I need to look at it from
 * a week to week basis... I should be able to kind of look up different tasks by the week...
 * that yellow background... is kind of throwing me off" — then, after a first attempt that
 * stacked/collapsed whole weeks on one page: "I don't want to see like, oh, the next week or
 * last week and stuff like that... I kind of want to be able to toggle throughout the days"):
 * one week on screen at a time, the exact same prev/next/"This week" strip already used on Team
 * Availability (TeamAvailabilityWeekPanel) and reused here via the same getWeek/formatWeekRange
 * helpers (src/lib/week.ts) rather than a pattern invented just for this page. The old "Needs
 * your attention / In progress / Completed" stat tiles (counted across every task ever assigned)
 * are replaced by a small color legend — a running total across all time stopped being the point
 * once the page itself only ever shows one week's worth at a time; AWAITING_REVIEW's card color
 * is now green instead of amber (see DateTaskRow's own TASK_TONE / status-tone.ts's IN_REVIEW),
 * confirmed by CB: "I like how submit awaiting review is there."
 *
 * The per-date "Tasks" link on Availability (AvailabilityCalendar.tsx) and My Schedule
 * (ScheduleView.tsx) still points at /tasks?date=<date>; weekOffsetForDate turns that date into
 * the week offset containing it, so landing here jumps straight to the right week (not
 * necessarily "this week") instead of a now-nonexistent full list, same "deep-link scrolls you
 * to it and briefly highlights it" shape as before — just scoped to a week instead of a page.
 *
 * Oct 2026, round three (CB: "I should be able to approve as well on the tasks page as well" —
 * until now the only place an admin/supervisor could actually approve a task was buried inside
 * that employee's own date on Availability/Schedule): a second tab, admin/supervisor only, for
 * every outstanding task across the team (listAllAwaitingReviewDateTasks via
 * /api/date-tasks/awaiting-review — org-wide for an admin, narrowed to just Daijour's own
 * reports for a SUPERVISOR). Deliberately a flat newest-first queue rather than the week-paged
 * view "My tasks" uses — a reviewer is clearing a backlog, not browsing a calendar.
 */
export default function MyTasksView({ employeeId, canReview }: { employeeId: string; canReview: boolean }) {
  const [tab, setTab] = useState<"mine" | "review">("mine");
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [offset, setOffset] = useState(0);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);
  const hasFocused = useRef(false);

  const [reviewTasks, setReviewTasks] = useState<DateTaskDTO[]>([]);
  const [reviewLoadState, setReviewLoadState] = useState<LoadState>("loading");

  // Oct 2026, round two (CB: "it should say completed tasks in the tasks page... and it update
  // there"): same closed-by-default Completed group DateTasksSection's Home widget already has,
  // now also here — a reviewer's own recent approvals, since once a task is approved it drops out
  // of the Awaiting review query entirely and would otherwise just vanish from this tab.
  const [completedReview, setCompletedReview] = useState<DateTaskDTO[]>([]);
  const [completedReviewLoadState, setCompletedReviewLoadState] = useState<LoadState>("loading");
  const [completedOpen, setCompletedOpen] = useState(false);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/date-tasks/${employeeId}`);
      if (!res.ok) throw new Error();
      const data: { tasks: DateTaskDTO[] } = await res.json();
      setTasks(data.tasks);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  async function loadReview() {
    setReviewLoadState("loading");
    try {
      const res = await fetch("/api/date-tasks/awaiting-review");
      if (!res.ok) throw new Error();
      const data: { tasks: DateTaskDTO[] } = await res.json();
      setReviewTasks(data.tasks);
      setReviewLoadState("ready");
    } catch {
      setReviewLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function loadCompletedReview() {
    if (!canReview) return;
    setCompletedReviewLoadState("loading");
    try {
      const res = await fetch("/api/date-tasks/recently-approved");
      if (!res.ok) throw new Error();
      const data: { tasks: DateTaskDTO[] } = await res.json();
      setCompletedReview(data.tasks);
      setCompletedReviewLoadState("ready");
    } catch {
      setCompletedReviewLoadState("error");
    }
  }

  useEffect(() => {
    if (!canReview) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReview();
    loadCompletedReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReview]);

  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get("date");
    if (date) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusDate(date);
      setOffset(weekOffsetForDate(date));
      window.history.replaceState(null, "", "/tasks");
    }
  }, []);

  // Oct 2026 (CB's Team tasks widget on Home now links its own "View N more" straight into this
  // tab via `?tab=review`, same deep-link-via-query-param shape the `date` param just above
  // already established): only takes effect when this viewer actually canReview — a regular
  // team member has no "review" tab to land on, so the default "mine" tab stays put for them.
  useEffect(() => {
    if (!canReview) return;
    const wantsReview = new URLSearchParams(window.location.search).get("tab") === "review";
    if (wantsReview) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab("review");
      window.history.replaceState(null, "", "/tasks");
    }
  }, [canReview]);

  useEffect(() => {
    if (!focusDate || loadState !== "ready" || hasFocused.current) return;
    if (!tasks.some((t) => t.taskDate === focusDate)) return;
    hasFocused.current = true;
    const el = document.querySelector(`[data-task-date="${focusDate}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightDate(focusDate);
    const timer = window.setTimeout(() => setHighlightDate(null), 2500);
    return () => window.clearTimeout(timer);
  }, [focusDate, loadState, tasks]);

  function loadReviewAll() {
    loadReview();
    loadCompletedReview();
  }

  const week = getWeek(offset);
  const weekTasks = [...tasks.filter((t) => t.taskDate >= week.start && t.taskDate <= week.end)].sort((a, b) =>
    a.taskDate === b.taskDate ? priorityRank(a) - priorityRank(b) : a.taskDate < b.taskDate ? -1 : 1
  );
  // The banner only shows while the deep-linked date's own week is actually on screen — paging
  // away from it (offset changes) retires the banner on its own, no separate dismiss-vs-navigate
  // bookkeeping needed.
  const showBanner = focusDate !== null && focusDate >= week.start && focusDate <= week.end;

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="page-title text-2xl">My Tasks</h1>
        <p className="text-sm text-muted mt-0.5">
          {tab === "mine" ? "Everything assigned to you, one week at a time." : "Every outstanding task across your team, oldest first."}
        </p>
      </div>

      {/* Oct 2026 (CB: "I should be able to approve as well on the tasks page as well"): admin/
          supervisor only — a regular team member never sees this row at all, same page as
          before. */}
      {canReview && (
        <div className="flex gap-1.5 bg-black/[0.04] rounded-full p-1 mb-4 w-fit">
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={`text-sm font-semibold rounded-full px-4 py-1.5 transition-colors ${
              tab === "mine" ? "bg-surface text-accent-ink shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            My tasks
          </button>
          <button
            type="button"
            onClick={() => setTab("review")}
            className={`text-sm font-semibold rounded-full px-4 py-1.5 transition-colors ${
              tab === "review" ? "bg-surface text-accent-ink shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            Awaiting review{reviewLoadState === "ready" && reviewTasks.length > 0 ? ` (${reviewTasks.length})` : ""}
          </button>
        </div>
      )}

      {tab === "mine" && (
      <>
      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-black/[0.04] animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your tasks. Please try again or contact HR.
        </div>
      )}

      {loadState === "ready" && (
        <>
          {showBanner && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 mb-4 text-sm">
              <span>
                Showing tasks for <strong className="text-accent-ink">{formatSlotDate(focusDate as string)}</strong>
              </span>
              <button
                type="button"
                onClick={() => setFocusDate(null)}
                className="text-xs font-semibold text-muted hover:text-accent-ink shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
              <button
                type="button"
                onClick={() => setOffset((o) => o - 1)}
                className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
                aria-label="Previous week"
              >
                ‹
              </button>
              <span className="text-sm font-semibold min-w-[150px] text-center tabular-nums">
                Week of {formatWeekRange(week.start, week.end)}
              </span>
              {offset === 0 && (
                <span className="text-[11px] font-semibold text-accent-ink bg-accent/10 rounded-full px-2.5 py-0.5">
                  This week
                </span>
              )}
              <button
                type="button"
                onClick={() => setOffset((o) => o + 1)}
                className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
                aria-label="Next week"
              >
                ›
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted">
              <LegendSwatch color="#b45309" label="Needs your action" />
              <LegendSwatch color="#047857" label="Awaiting review" />
              <LegendSwatch color="var(--ttc-pink-ink)" label="Approved" />
            </div>
          </div>

          {weekTasks.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
              <ChecklistIcon className="h-8 w-8 text-muted/60" />
              Nothing assigned for this week.
            </div>
          ) : (
            <div className="space-y-2.5">
              {weekTasks.map((t) => (
                <div
                  key={t.id}
                  data-task-date={t.taskDate}
                  className={`transition-[outline-color,background-color] duration-500 rounded-2xl ${
                    highlightDate === t.taskDate ? "outline outline-2 outline-accent bg-accent/[0.04] -m-1 p-1" : ""
                  }`}
                >
                  <DateTaskRow task={t} viewerId={employeeId} canReview={false} showDate onChanged={load} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
      </>
      )}

      {tab === "review" && (
        <>
          {reviewLoadState === "loading" && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-black/[0.04] animate-pulse" />
              ))}
            </div>
          )}

          {reviewLoadState === "error" && (
            <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
              Unable to load the team&apos;s tasks. Please try again or contact HR.
            </div>
          )}

          {reviewLoadState === "ready" && reviewTasks.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
              <ChecklistIcon className="h-8 w-8 text-muted/60" />
              Nothing waiting on a review right now.
            </div>
          )}

          {reviewLoadState === "ready" && reviewTasks.length > 0 && (
            <div className="space-y-2.5">
              {reviewTasks.map((t) => (
                <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview showDate showEmployee onChanged={loadReviewAll} />
              ))}
            </div>
          )}

          {/* Oct 2026, round two (CB: "it should say completed tasks in the tasks page... and it
              update there"): closed by default, same reasoning as the Home widget's own
              Completed group — once approved, a task is no longer the thing needing this
              reviewer's attention, so it stays out of the way until asked for. */}
          {completedReviewLoadState === "ready" && completedReview.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setCompletedOpen((v) => !v)}
                aria-expanded={completedOpen}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-black/[0.02] px-3.5 py-2.5 text-sm font-medium text-muted hover:bg-black/[0.04] transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <ChecklistIcon className="h-3.5 w-3.5" />
                  Completed <span className="text-foreground font-semibold">({completedReview.length})</span>
                </span>
                <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${completedOpen ? "rotate-180" : ""}`} />
              </button>
              {completedOpen && (
                <div className="space-y-2.5 mt-2.5">
                  {completedReview.map((t) => (
                    <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} showDate showEmployee onChanged={loadReviewAll} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}
