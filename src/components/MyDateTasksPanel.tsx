"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";

type LoadState = "loading" | "ready" | "error";

/**
 * The employee's OWN view of one date's pushed tasks, scoped to wherever that date already
 * comes up for them — currently AvailabilityCalendar's SubmissionDetail panel and ScheduleView's
 * own shift detail. CB, Sept 2026: "on the availability tab... I probably want some of the
 * features of what was approved or what was selected to reflect on the availability page,
 * especially on the mobile side" — and, on tasks specifically: "once we create the task on the
 * receiving end, they'll be able to probably click on... a check mark just to see that they
 * completed" it. Same underlying DateTask data as the dashboard's own "Your tasks" section
 * (DateTasksSection), just a compact, single-date-scoped read/act view that lives right where an
 * employee is already looking at that specific date, rather than asking them to go find it in a
 * separate global list.
 *
 * Correction brief #2 (Sept 2026): tasks now carry a real lifecycle (Start/Submit rather than a
 * single "Mark done") and their own comment thread — both rendered by the shared DateTaskRow,
 * with `canReview` always false here since the employee viewing their own task is never the one
 * who approves it.
 *
 * Deliberately NOT DateTasksSection reused directly: that component is global-list-shaped
 * (every non-Approved task, across all dates) and hides itself entirely when there's nothing to
 * show — exactly wrong for a slot that's meant to sit inside a specific date's own detail. This
 * stays visible even when empty ("No tasks for this date yet"), matching DateTasksPanel's own
 * admin-side empty state, so the two sides of one date's task list read as the same feature.
 * Deliberately NOT DateTasksPanel itself either — that one carries the push form and
 * Approve/Send back controls, which only make sense for the admin/supervisor who pushed the
 * task, not the employee receiving it.
 */
export default function MyDateTasksPanel({ employeeId, taskDate }: { employeeId: string; taskDate: string }) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/date-tasks/${employeeId}`);
      if (!res.ok) throw new Error();
      const data: { tasks: DateTaskDTO[] } = await res.json();
      setTasks(data.tasks.filter((t) => t.taskDate === taskDate));
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, taskDate]);

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="divide-y divide-border max-h-[26rem] overflow-y-auto">
        {loadState === "loading" && (
          <div className="p-3.5">
            <div className="h-9 rounded-lg bg-black/[0.04] animate-pulse" />
          </div>
        )}
        {loadState === "error" && (
          <p className="p-3.5 text-sm text-accent">Unable to load tasks. Please try again.</p>
        )}
        {loadState === "ready" && tasks.length === 0 && (
          <p className="p-3.5 text-sm text-muted">No tasks for this date yet.</p>
        )}
        {loadState === "ready" &&
          tasks.map((t) => (
            <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} onChanged={load} />
          ))}
      </div>
    </div>
  );
}
