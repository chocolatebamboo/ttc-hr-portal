"use client";

import { useEffect, useRef, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import PayrollPeriodSwitcher from "@/components/PayrollPeriodSwitcher";
import { ChecklistIcon, ChevronDownIcon } from "@/components/icons";
import { formatSlotDate } from "@/lib/availability-format";
import { getPayrollPeriod, getCurrentPayrollPeriodOffset, payrollPeriodOffsetForDate } from "@/lib/week";

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
 * one window of time on screen at a time, prev/next arrows plus a badge for the current one (same
 * shell TeamAvailabilityWeekPanel's own week nav uses) rather than everything stacked on one
 * page. The old "Needs your attention / In progress / Completed" stat tiles (counted across
 * every task ever assigned) are replaced by a small color legend — a running total across all
 * time stopped being the point once the page itself only ever shows one window's worth at a
 * time; AWAITING_REVIEW's card color is now green instead of amber (see DateTaskRow's own
 * TASK_TONE / status-tone.ts's IN_REVIEW), confirmed by CB: "I like how submit awaiting review
 * is there."
 *
 * The per-date "Tasks" link on Availability (AvailabilityCalendar.tsx) and My Schedule
 * (ScheduleView.tsx) still points at /tasks?date=<date>; this jumps straight to the window
 * containing that date (not necessarily "now") instead of a now-nonexistent full list, same
 * "deep-link scrolls you to it and briefly highlights it" shape as before — just scoped to one
 * window instead of a page.
 *
 * Oct 2026, round three (CB: "I should be able to approve as well on the tasks page as well" —
 * until now the only place an admin/supervisor could actually approve a task was buried inside
 * that employee's own date on Availability/Schedule): a second tab, admin/supervisor only, for
 * every outstanding task across the team (listAllAwaitingReviewDateTasks via
 * /api/date-tasks/awaiting-review — org-wide for an admin, narrowed to just Daijour's own
 * reports for a SUPERVISOR).
 *
 * Oct 2026, round four (CB, after reporting she couldn't find a specific team member's task —
 * it turned out to exist, just submitted over two weeks earlier and so already outside both this
 * page's one-week "My tasks" window AND entirely unbounded-but-undiscoverable in "Awaiting
 * review"'s flat list: "I should be able to see all the tasks that's [under] review for that
 * period of time... based off of those two week intervals"): both tabs now page by the same
 * 2-week pay period getPayrollPeriod/PayrollPeriodSwitcher (src/lib/week.ts,
 * src/components/PayrollPeriodSwitcher.tsx) use everywhere else in the app, instead of "My
 * tasks"' old calendar-week window and "Awaiting review"'s old no-window-at-all flat queue —
 * bucketed by each task's own taskDate (matching how "My tasks" already bucketed), so paging
 * back one period surfaces a two-and-a-half-week-old submission exactly where it is instead of
 * requiring an unbounded scroll or several week-by-week clicks to find it. "Awaiting review"'s
 * own tab badge count stays unscoped (every outstanding task, not just this period's) so it
 * keeps working as a true backlog indicator even while viewing an empty period.
 *
 * Oct 2026, round five (CB, looking at her own admin view next to Haile's team-member preview:
 * "it should be very similar for the team members... I like how it says awaiting review or my
 * tasks... it has that view"): a regular team member (canReview false) now gets the same
 * two-tab shape as a reviewer, just scoped to their own tasks instead of the whole team's — "My
 * tasks" is everything NOT currently sitting in someone else's queue (assigned, in progress,
 * returned, or already approved), "Awaiting review" is the subset of their own `weekTasks`
 * they've already turned in and are waiting to hear back on. No second fetch or second period
 * for this case (unlike the reviewer's own `reviewOffset`): both tabs are just a status split
 * of the one `weekTasks` this page already loads for "My tasks," sharing the one
 * `offset`/switcher, since for a single person's own tasks "what needs action" and "what's
 * awaiting review" are two views onto the exact same list rather than two different queries.
 * `myAwaitingReviewCount` mirrors the reviewer tab's own unscoped badge (every outstanding
 * submission, not just this period's) for the same reason that one stayed unscoped — see its
 * doc comment just above.
 */
export default function MyTasksView({ employeeId, canReview }: { employeeId: string; canReview: boolean }) {
  const [tab, setTab] = useState<"mine" | "review">("mine");
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // Round four — a getPayrollPeriod offset (see PayrollPeriodSwitcher's own doc comment), not a
  // calendar-week offset the way this used to be. Opens on whichever period actually contains
  // today, same reasoning as LoggedHoursSection's own switcher.
  const [offset, setOffset] = useState(getCurrentPayrollPeriodOffset);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);
  const hasFocused = useRef(false);

  const [reviewTasks, setReviewTasks] = useState<DateTaskDTO[]>([]);
  const [reviewLoadState, setReviewLoadState] = useState<LoadState>("loading");
  // Round four — same idea as `offset` above, just a separate offset so paging "My tasks" and
  // "Awaiting review" don't move each other's window.
  const [reviewOffset, setReviewOffset] = useState(getCurrentPayrollPeriodOffset);

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
      setOffset(payrollPeriodOffsetForDate(date));
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

  const period = getPayrollPeriod(offset);
  const weekTasks = [...tasks.filter((t) => t.taskDate >= period.start && t.taskDate <= period.end)].sort((a, b) =>
    a.taskDate === b.taskDate ? priorityRank(a) - priorityRank(b) : a.taskDate < b.taskDate ? -1 : 1
  );
  // Round five — the non-reviewer split of weekTasks above into the same two buckets a reviewer
  // already sees, just scoped to this one person's own tasks. See this component's own doc
  // comment for why these are a client-side filter of weekTasks rather than a second fetch.
  const myActionTasks = weekTasks.filter((t) => t.status !== "AWAITING_REVIEW");
  const myAwaitingTasks = weekTasks.filter((t) => t.status === "AWAITING_REVIEW");
  const myAwaitingReviewCount = tasks.filter((t) => t.status === "AWAITING_REVIEW").length;
  const mineTasks = canReview ? weekTasks : myActionTasks;
  // The banner only shows while the deep-linked date's own period is actually on screen — paging
  // away from it (offset changes) retires the banner on its own, no separate dismiss-vs-navigate
  // bookkeeping needed.
  const showBanner = focusDate !== null && focusDate >= period.start && focusDate <= period.end;

  // Round four — reviewTasks itself is never date-bounded server-side (listAllAwaitingReviewDateTasks
  // is a flat "everything outstanding" query), so the period scoping happens here, same as
  // weekTasks above, keyed off each task's own taskDate.
  const reviewPeriod = getPayrollPeriod(reviewOffset);
  const periodReviewTasks = reviewTasks.filter((t) => t.taskDate >= reviewPeriod.start && t.taskDate <= reviewPeriod.end);

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="page-title text-2xl">My Tasks</h1>
        <p className="text-sm text-muted mt-0.5">
          {tab === "mine"
            ? "Everything assigned to you, one pay period at a time."
            : canReview
              ? "Every outstanding task across your team, by pay period."
              : "Tasks you've turned in and are waiting to hear back on, by pay period."}
        </p>
      </div>

      {/* Oct 2026, round five (CB: "it should be very similar for the team members... I like how
          it says awaiting review or my tasks"): this row used to be admin/supervisor only — a
          regular team member saw no tabs at all, just the one flat list below. Now everyone gets
          the same two tabs; only the second tab's meaning and count differ by canReview (see
          this component's own doc comment). */}
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
          Awaiting review
          {canReview
            ? reviewLoadState === "ready" && reviewTasks.length > 0
              ? ` (${reviewTasks.length})`
              : ""
            : loadState === "ready" && myAwaitingReviewCount > 0
              ? ` (${myAwaitingReviewCount})`
              : ""}
        </button>
      </div>

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
            <PayrollPeriodSwitcher offset={offset} onOffsetChange={setOffset} />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted">
              <LegendSwatch color="#b45309" label="Needs your action" />
              <LegendSwatch color="#047857" label="Awaiting review" />
              <LegendSwatch color="var(--ttc-pink-ink)" label="Approved" />
            </div>
          </div>

          {mineTasks.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
              <ChecklistIcon className="h-8 w-8 text-muted/60" />
              {canReview || myAwaitingTasks.length === 0
                ? "Nothing assigned for this period."
                : "Nothing needs your action this period — check Awaiting review."}
            </div>
          ) : (
            <div className="space-y-2.5">
              {mineTasks.map((t) => (
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

      {tab === "review" && canReview && (
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

          {reviewLoadState === "ready" && (
            <div className="mb-4">
              <PayrollPeriodSwitcher offset={reviewOffset} onOffsetChange={setReviewOffset} />
            </div>
          )}

          {/* Round four: the unscoped "there's nothing outstanding anywhere" case reads
              differently from "nothing in THIS period" — the first means the queue is actually
              empty, the second means paging to a different period (most often Current, one tap
              away on the switcher above) will find it. This exact distinction is what CB's own
              report ("I'm not seeing the tasks for Haile") turned out to be. */}
          {reviewLoadState === "ready" && reviewTasks.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
              <ChecklistIcon className="h-8 w-8 text-muted/60" />
              Nothing waiting on a review right now.
            </div>
          )}

          {reviewLoadState === "ready" && reviewTasks.length > 0 && periodReviewTasks.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
              <ChecklistIcon className="h-8 w-8 text-muted/60" />
              Nothing awaiting review in this period — try paging to a different one.
            </div>
          )}

          {reviewLoadState === "ready" && periodReviewTasks.length > 0 && (
            <div className="space-y-2.5">
              {periodReviewTasks.map((t) => (
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

      {/* Round five — the non-reviewer "Awaiting review" tab: this person's own weekTasks,
          already loaded for "My tasks" above, just narrowed to AWAITING_REVIEW. Shares that
          tab's `offset`/switcher rather than a second one (see this component's own doc
          comment), since there's no second query here to page independently. */}
      {tab === "review" && !canReview && (
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
              <div className="mb-4">
                <PayrollPeriodSwitcher offset={offset} onOffsetChange={setOffset} />
              </div>

              {myAwaitingTasks.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
                  <ChecklistIcon className="h-8 w-8 text-muted/60" />
                  Nothing of yours is waiting on a review this period.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {myAwaitingTasks.map((t) => (
                    <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} showDate onChanged={load} />
                  ))}
                </div>
              )}
            </>
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
