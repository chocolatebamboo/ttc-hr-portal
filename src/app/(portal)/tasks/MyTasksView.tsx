"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import { ChecklistIcon } from "@/components/icons";

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

/**
 * CB, Oct 2026: "there should be like a task page so you can see all your tasks... I want to see
 * it cleanly." Until now a team member's tasks only ever showed up scattered one date at a time
 * (MyDateTasksPanel, on that date's Availability/Schedule card) or folded into the dashboard's
 * "Your tasks" section (DateTasksSection, which drops anything already Approved). This page is
 * the first place every task assigned to you — across every date, including the ones you've
 * already finished — is gathered in one list.
 *
 * Reuses the same `/api/date-tasks/{employeeId}` route and DateTaskRow card the existing
 * per-date panels already use (no new backend needed — see listDateTasks's self-access rule in
 * src/lib/date-tasks.ts), just grouped here into three sections instead of one flat list, and
 * with nothing filtered out: Needs your attention (new or sent-back — see needsAttention above),
 * In progress (started, or submitted and awaiting a reviewer), and Completed (Approved) — the
 * same three buckets CB approved in the mockup.
 */
export default function MyTasksView({ employeeId }: { employeeId: string }) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

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

  const attention = tasks.filter(needsAttention);
  const progress = tasks.filter(inProgress);
  const completed = tasks.filter((t) => t.status === "APPROVED");

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
          <div className="grid grid-cols-3 gap-2.5 mb-6">
            <StatTile value={attention.length} label="Needs your attention" color="#b45309" />
            <StatTile value={progress.length} label="In progress" color="var(--ttc-blue-ink)" />
            <StatTile value={completed.length} label="Completed" color="var(--ttc-pink-ink)" />
          </div>

          <TaskGroup title="Needs your attention" dotColor="#b45309" tasks={attention} employeeId={employeeId} onChanged={load} />
          <TaskGroup title="In progress" dotColor="var(--ttc-blue)" tasks={progress} employeeId={employeeId} onChanged={load} />
          <TaskGroup title="Completed" dotColor="var(--ttc-pink)" tasks={completed} employeeId={employeeId} onChanged={load} last />
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

function TaskGroup({
  title,
  dotColor,
  tasks,
  employeeId,
  onChanged,
  last = false,
}: {
  title: string;
  dotColor: string;
  tasks: DateTaskDTO[];
  employeeId: string;
  onChanged: () => void;
  last?: boolean;
}) {
  // An empty group just isn't shown — no "Needs your attention (0)" header sitting above nothing,
  // same "shows while true" convention DateTasksSection already uses on the dashboard.
  if (tasks.length === 0) return null;

  return (
    <div className={last ? "" : "mb-6"}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: dotColor }} />
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted">{title}</h2>
        <span className="text-[11px] font-semibold text-muted bg-black/5 rounded-full px-2 py-0.5">{tasks.length}</span>
      </div>
      <div className="space-y-2.5">
        {tasks.map((t) => (
          <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} showDate onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
