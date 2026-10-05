"use client";

import { useEffect, useRef, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import { ChecklistIcon } from "@/components/icons";
import { formatSlotDate } from "@/lib/availability-format";
import { todayDateKey } from "@/lib/time";

type LoadState = "loading" | "ready" | "error";

/** A task needs the employee to actually do something with it right now — it's new, or it was
 *  just sent back and needs to be redone. Same statuses DateTaskRow's own `canTapComplete`
 *  treats as actionable for the task's own employee. */
function needsAttention(t: DateTaskDTO): boolean {
  return t.status === "ASSIGNED" || t.status === "RETURNED";
}

/** Already started, or already turned in and waiting on a reviewer — real progress, but nothing
 *  left for the employee to decide right now (AWAITING_REVIEW is out of their hands). */
function inProgress(t: DateTaskDTO): boolean {
  return t.status === "IN_PROGRESS" || t.status === "AWAITING_REVIEW";
}

/** Same priority a plain status-bucketed view would use — needs-attention first, then
 *  in-progress, completed last — now applied WITHIN a date group instead of across the whole
 *  page, so a date with several tasks still surfaces the one that needs you first. */
function priorityRank(t: DateTaskDTO): number {
  if (needsAttention(t)) return 0;
  if (inProgress(t)) return 1;
  return 2;
}

/**
 * CB, Oct 2026: "there should be like a task page so you can see all your tasks... I want to see
 * it cleanly." Until now a team member's tasks only ever showed up scattered one date at a time
 * (MyDateTasksPanel, on that date's Availability/Schedule card) or folded into the dashboard's
 * "Your tasks" section (DateTasksSection, which drops anything already Approved). This page is
 * the first place every task assigned to you — across every date, including the ones you've
 * already finished — is gathered in one list.
 *
 * Reuses the same `/api/date-tasks/{employeeId}` route and DateTaskRow card the existing
 * per-date panels already used (no new backend needed — see listDateTasks's self-access rule in
 * src/lib/date-tasks.ts).
 *
 * Oct 2026 (CB, follow-up: "I wanna be able to see like the past tasks and I want them to be
 * organized well... like how on the card we have the icon with the task... I wanna be able to
 * click that and it goes to that task page so we could see all the things relating to that
 * particular date"): grouped by status alone, a date you had several tasks on could end up split
 * across three separate sections, and nothing made it easy to find your history for one specific
 * date. Tasks are now grouped by the date they're FOR (taskDate), oldest first, each group
 * labeled Past or Upcoming — the three stat tiles up top stay as a quick status overview, but
 * browsing the page itself now reads as a timeline, not three buckets. The per-date "Tasks" link
 * on Availability (AvailabilityCalendar.tsx) and My Schedule (ScheduleView.tsx) points at
 * /tasks?date=<date>, read here the same way AnnouncementsView reads ?id= — straight off
 * window.location, not next/navigation's useSearchParams, so this page doesn't need a Suspense
 * boundary. Landing on a date scrolls to and briefly highlights that group, with a banner up top
 * naming which date brought you here (since every other date's tasks are still on the page too —
 * same "deep-link scrolls you to it, doesn't hide everything else" shape Announcements uses).
 */
export default function MyTasksView({ employeeId }: { employeeId: string }) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);
  const hasFocused = useRef(false);

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get("date");
    if (date) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusDate(date);
      window.history.replaceState(null, "", "/tasks");
    }
  }, []);

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

  const attention = tasks.filter(needsAttention);
  const progress = tasks.filter(inProgress);
  const completed = tasks.filter((t) => t.status === "APPROVED");

  const dateKeys = [...new Set(tasks.map((t) => t.taskDate))].sort();
  const today = todayDateKey();
  const showBanner = focusDate !== null && tasks.some((t) => t.taskDate === focusDate);

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="page-title text-2xl">My Tasks</h1>
        <p className="text-sm text-muted mt-0.5">Everything assigned to you, in one place.</p>
      </div>

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

      {loadState === "ready" && tasks.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
          <ChecklistIcon className="h-8 w-8 text-muted/60" />
          Nothing assigned to you right now — check back later.
        </div>
      )}

      {loadState === "ready" && tasks.length > 0 && (
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
                View all tasks
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5 mb-6">
            <StatTile value={attention.length} label="Needs your attention" color="#b45309" />
            <StatTile value={progress.length} label="In progress" color="var(--ttc-blue-ink)" />
            <StatTile value={completed.length} label="Completed" color="var(--ttc-pink-ink)" />
          </div>

          <div className="space-y-6">
            {dateKeys.map((date) => {
              const dayTasks = [...tasks.filter((t) => t.taskDate === date)].sort(
                (a, b) => priorityRank(a) - priorityRank(b)
              );
              return (
                <DateGroup
                  key={date}
                  date={date}
                  isPast={date < today}
                  tasks={dayTasks}
                  employeeId={employeeId}
                  highlighted={highlightDate === date}
                  onChanged={load}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xl font-bold leading-none mb-1" style={{ color }}>
        {value}
      </p>
      <p className="text-xs font-medium text-muted">{label}</p>
    </div>
  );
}

function DateGroup({
  date,
  isPast,
  tasks,
  employeeId,
  highlighted,
  onChanged,
}: {
  date: string;
  isPast: boolean;
  tasks: DateTaskDTO[];
  employeeId: string;
  highlighted: boolean;
  onChanged: () => void;
}) {
  return (
    <div
      data-task-date={date}
      className={`transition-[outline-color,background-color] duration-500 rounded-2xl ${
        highlighted ? "outline outline-2 outline-accent bg-accent/[0.04] -m-2.5 p-2.5" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <h2 className="text-xs font-bold text-foreground">{formatSlotDate(date)}</h2>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${
            isPast ? "bg-black/5 text-muted" : "bg-accent/10 text-accent-ink"
          }`}
        >
          {isPast ? "Past" : "Upcoming"}
        </span>
        <span className="text-[11px] font-semibold text-muted bg-black/5 rounded-full px-2 py-0.5">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2.5">
        {tasks.map((t) => (
          <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
