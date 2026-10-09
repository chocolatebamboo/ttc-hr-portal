"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import SwipeReveal from "@/components/SwipeReveal";
import { ChevronDownIcon, CheckCircleIcon } from "@/components/icons";

type LoadState = "loading" | "ready" | "error";

/** Content-derived dismissal key (src/lib/dashboard-dismissals.ts) — includes the task's current
 *  status so a later status change (sent back, resubmitted, approved) is new information and
 *  isn't swallowed by an old "cleared from Home" dismissal, same scheme every other
 *  dashboard-dismissals caller already follows (see AnnouncementsSection's own doc comment). */
function dismissKeyFor(task: DateTaskDTO): string {
  return `date-task:${task.id}:${task.status}`;
}

const MAX_VISIBLE_ACTIVE = 3;

/**
 * The employee-facing half of the date-task feature — CB, Sept 2026: "we should be also able
 * to push different tasks within that specific day... on the receiving end, they would see it
 * on their main dashboard." An admin/supervisor pushes a task from a date's card
 * (DateTasksPanel); it shows up here until the employee submits it, and then it stays listed as
 * "Awaiting review" until an admin/supervisor confirms it there — a submitted task isn't
 * finished from the employee's side alone.
 *
 * Correction brief #2 (Sept 2026): the old single "Mark done" action is now the DateTaskRow's
 * own Start/Submit lifecycle, and each task carries its own comment thread instead of a
 * standalone per-date conversation — see DateTaskRow's own doc comment.
 *
 * Collapsible (CB, Oct 2026: "I don't want it to be too cluttered... I want to make sure that
 * it's collapsible" — this widget sits on Home, above several other sections, so a team member
 * with several tasks assigned was pushing everything below it down the page). Starts open (the
 * common case is one or two tasks, where collapsing by default would just be an extra tap to see
 * them) — the count in the header lets you tell at a glance how many are in there either way.
 *
 * Oct 2026, round seven (CB, looking at this on her own admin dashboard: "let's say Sean or
 * Daijour needs to approve a task... they should be able to click that circle to confirm that
 * it's complete... I need to see who it's coming from... and I should be able to review what
 * they submitted"): up to now this only ever showed tasks ASSIGNED TO the signed-in employee —
 * an admin/supervisor had no way to actually approve anything from Home, only from the Tasks
 * page's own "Awaiting review" tab (MyTasksView). `canReview` (passed down from
 * canSeeAdminHomeDashboard on the dashboard page, same gate every other admin-only Home fetch
 * already uses) now also pulls in every task across the team that's awaiting THIS reviewer's
 * decision — same listAllAwaitingReviewDateTasks query that tab already uses — merged in ahead
 * of the viewer's own tasks, with the employee chip and Approve/Send back actions switched on
 * (showEmployee/canReview on DateTaskRow, both already built for that tab). The heading itself
 * switches to "Team tasks" in that mode (CB: "it needs to say more like team tasks") since it's
 * no longer just "assigned to you." A task that's both the viewer's own AND awaiting their own
 * review (an admin's self-assigned test task, same as CB's own) is de-duplicated into the review
 * row only, so it gets the reviewable treatment instead of the old inert circle.
 *
 * Capped at MAX_VISIBLE_ACTIVE outstanding tasks (CB: "if we get multiple tasks... there will be
 * a drop down and like maybe a view more so they could see it properly on the tasks page") — the
 * rest collapse behind a "View N more in Tasks →" link straight to the Tasks page's own Awaiting
 * review tab (`?tab=review`, see MyTasksView's own doc comment) rather than letting Home's own
 * list grow without bound.
 *
 * Swipe-to-clear (CB: "swipe left to kind of clear that notification... it will still show up in
 * the my tasks page"): same SwipeReveal gesture AnnouncementsSection already uses, same
 * dashboard-dismissals.ts per-employee server dismissal (not a client-only hide) — deliberately
 * no always-visible × button here unlike that component, since this card's own right-side column
 * is already busy with the Approve/circle control and a second overlapping control there would
 * crowd it; the swipe gesture alone, plus the one-line hint under the header, is the whole
 * affordance.
 *
 * Oct 2026, round eight (CB: "I should be able to see on her side, like a completed task
 * section"): approved tasks collapse into their own closed-by-default "Completed" group
 * underneath the active ones instead of disappearing — in `canReview` mode this also includes
 * the reviewer's own recent approvals (listRecentlyApprovedDateTasks), not just the viewer's own
 * completed assignments, so an admin can see what they've already confirmed without it crowding
 * the active list above. The section as a whole only hides once there's truly nothing here, ever
 * (no active tasks AND no completed history, across everything this viewer can see).
 */
export default function DateTasksSection({
  className,
  employeeId,
  canReview = false,
}: {
  className?: string;
  employeeId: string;
  /** Admin, or Daijour's own SUPERVISOR role — may also see and act on the team's outstanding
   *  tasks here, not just their own. Mirrors canSeeAdminHomeDashboard's own gate on the dashboard
   *  page; the server enforces this independently either way via listAllAwaitingReviewDateTasks /
   *  listRecentlyApprovedDateTasks. */
  canReview?: boolean;
}) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const [reviewTasks, setReviewTasks] = useState<DateTaskDTO[]>([]);
  const [reviewLoadState, setReviewLoadState] = useState<LoadState>(canReview ? "loading" : "error");

  const [recentlyApproved, setRecentlyApproved] = useState<DateTaskDTO[]>([]);
  const [completedReviewLoadState, setCompletedReviewLoadState] = useState<LoadState>(canReview ? "loading" : "error");

  const [collapsed, setCollapsed] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [clearedNow, setClearedNow] = useState<Set<string>>(new Set());

  async function loadMine() {
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
    if (!canReview) return;
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

  async function loadRecentlyApproved() {
    if (!canReview) return;
    setCompletedReviewLoadState("loading");
    try {
      const res = await fetch("/api/date-tasks/recently-approved");
      if (!res.ok) throw new Error();
      const data: { tasks: DateTaskDTO[] } = await res.json();
      setRecentlyApproved(data.tasks);
      setCompletedReviewLoadState("ready");
    } catch {
      setCompletedReviewLoadState("error");
    }
  }

  function loadAll() {
    loadMine();
    loadReview();
    loadRecentlyApproved();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, canReview]);

  const stillLoading =
    loadState === "loading" || (canReview && (reviewLoadState === "loading" || completedReviewLoadState === "loading"));

  // Each fetch's own failure just contributes nothing rather than hiding the whole widget — this
  // stays a best-effort, optional dashboard section even if one of its three sources is down.
  const ownTasks = loadState === "ready" ? tasks : [];
  const teamReviewTasks = canReview && reviewLoadState === "ready" ? reviewTasks : [];
  const teamRecentlyApproved = canReview && completedReviewLoadState === "ready" ? recentlyApproved : [];

  const reviewTaskIds = new Set(teamReviewTasks.map((t) => t.id));
  const activeOwn = ownTasks.filter((t) => t.status !== "APPROVED" && !reviewTaskIds.has(t.id));
  const completedOwn = ownTasks.filter((t) => t.status === "APPROVED");

  const completedMap = new Map<string, DateTaskDTO>();
  for (const t of [...completedOwn, ...teamRecentlyApproved]) completedMap.set(t.id, t);
  const completedTasks = Array.from(completedMap.values());

  // Checks this task's reviewer eligibility against its own id, not just which array it came
  // from — teamReviewTasks already is exactly "what this viewer may review," so every row here
  // gets canReview + showEmployee together.
  const activeAllRaw = [...teamReviewTasks, ...activeOwn];
  const activeAll = activeAllRaw.filter((t) => !clearedNow.has(dismissKeyFor(t)));
  const completedVisible = completedTasks.filter((t) => !clearedNow.has(dismissKeyFor(t)));

  // Bulk-checks server-side dismissal for whatever just loaded, once everything has settled —
  // see dismiss/dismissed route comments for why this is a content-derived key lookup rather
  // than a flag stored on the task itself.
  useEffect(() => {
    if (stillLoading) return;
    const keys = [...activeAllRaw, ...completedTasks].map(dismissKeyFor);
    if (keys.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/date-tasks/dismissed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys }),
        });
        if (!res.ok) return;
        const data: { dismissed: string[] } = await res.json();
        if (data.dismissed.length === 0) return;
        setClearedNow((prev) => new Set([...prev, ...data.dismissed]));
      } catch {
        // best-effort — worst case a previously-cleared card briefly reappears until swiped again
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillLoading]);

  function clearTask(task: DateTaskDTO) {
    const key = dismissKeyFor(task);
    setClearedNow((prev) => new Set(prev).add(key));
    fetch("/api/date-tasks/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }).catch(() => {
      // best-effort, same fire-and-forget convention AnnouncementsSection's dismissAnnouncement uses
    });
  }

  if (!stillLoading && activeAll.length === 0 && completedVisible.length === 0) return null;

  const visibleActive = activeAll.slice(0, MAX_VISIBLE_ACTIVE);
  const overflowCount = activeAll.length - visibleActive.length;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between mb-2"
      >
        <h2 className="text-sm font-medium text-muted">
          {canReview ? "Team tasks" : "Your tasks"}
          {!stillLoading && activeAll.length > 0 ? ` (${activeAll.length})` : ""}
        </h2>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
        />
      </button>
      {!collapsed && (
        <div className="space-y-2.5">
          {stillLoading && <div className="h-16 rounded-2xl bg-black/[0.04] animate-pulse" />}

          {!stillLoading && (activeAll.length > 0 || completedVisible.length > 0) && (
            <p className="text-[11px] text-muted">
              Swipe a card left to clear it from Home — it stays on the Tasks page.
            </p>
          )}

          {!stillLoading &&
            visibleActive.map((t) => (
              <SwipeReveal
                key={t.id}
                actionSide="right"
                actionLabel="Clear"
                actionIcon={<CheckCircleIcon className="h-4 w-4" />}
                actionClassName="bg-black/15 text-white rounded-2xl"
                onAction={() => clearTask(t)}
              >
                <DateTaskRow
                  task={t}
                  viewerId={employeeId}
                  canReview={canReview && reviewTaskIds.has(t.id)}
                  showDate
                  showEmployee={canReview && reviewTaskIds.has(t.id)}
                  onChanged={loadAll}
                />
              </SwipeReveal>
            ))}

          {!stillLoading && overflowCount > 0 && (
            <Link
              href={canReview ? "/tasks?tab=review" : "/tasks"}
              className="flex items-center justify-center gap-1.5 w-full text-[12.5px] font-semibold text-accent-ink bg-accent/5 hover:bg-accent/10 border border-dashed border-accent/25 rounded-xl py-2.5 transition-colors"
            >
              View {overflowCount} more in Tasks →
            </Link>
          )}

          {/* Oct 2026 (CB: "I should be able to see on her side, like a completed task
              section"): closed by default, same reasoning as the section's own outer collapse —
              approved tasks are no longer the thing needing attention, so they stay out of the
              way until asked for. */}
          {!stillLoading && completedVisible.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setCompletedOpen((v) => !v)}
                aria-expanded={completedOpen}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-black/[0.02] px-3.5 py-2.5 text-sm font-medium text-muted hover:bg-black/[0.04] transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <CheckCircleIcon className="h-3.5 w-3.5" />
                  Completed <span className="text-foreground font-semibold">({completedVisible.length})</span>
                </span>
                <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${completedOpen ? "rotate-180" : ""}`} />
              </button>
              {completedOpen &&
                completedVisible.map((t) => (
                  <SwipeReveal
                    key={t.id}
                    actionSide="right"
                    actionLabel="Clear"
                    actionIcon={<CheckCircleIcon className="h-4 w-4" />}
                    actionClassName="bg-black/15 text-white rounded-2xl"
                    onAction={() => clearTask(t)}
                  >
                    <DateTaskRow
                      task={t}
                      viewerId={employeeId}
                      canReview={false}
                      showDate
                      showEmployee={canReview && t.employeeId !== employeeId}
                      onChanged={loadAll}
                    />
                  </SwipeReveal>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
