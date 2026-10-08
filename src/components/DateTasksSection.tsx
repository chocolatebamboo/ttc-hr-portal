"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import { ChevronDownIcon, CheckCircleIcon } from "@/components/icons";

type LoadState = "loading" | "ready" | "error";

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
 * Oct 2026, round two — moved up to sit right under the dashboard's own notification banners
 * (CB: the task cards "needs to go up top," same top-of-page spot as everything else she already
 * calls a notification) and at the same time, CB: "I should be able to see on her side, like a
 * completed task section" — approved tasks used to be filtered out of `tasks` entirely and the
 * whole section hid itself once nothing else was left (see this file's git history for that old
 * shape). Now they collapse into their own closed-by-default "Completed" group underneath the
 * active ones instead of disappearing — the section as a whole only hides once there's truly
 * nothing here, ever (no active tasks AND no completed history).
 */
export default function DateTasksSection({ className, employeeId }: { className?: string; employeeId: string }) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [collapsed, setCollapsed] = useState(false);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  // Best-effort, optional section — an error here or a genuinely empty history just means
  // nothing to show, not a broken dashboard.
  if (loadState === "error" || (loadState === "ready" && tasks.length === 0)) return null;

  const activeTasks = tasks.filter((t) => t.status !== "APPROVED");
  const completedTasks = tasks.filter((t) => t.status === "APPROVED");

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between mb-2"
      >
        <h2 className="text-sm font-medium text-muted">
          Your tasks{loadState === "ready" && activeTasks.length > 0 ? ` (${activeTasks.length})` : ""}
        </h2>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
        />
      </button>
      {!collapsed && (
        <div className="space-y-2.5">
          {loadState === "loading" && <div className="h-16 rounded-2xl bg-black/[0.04] animate-pulse" />}
          {loadState === "ready" &&
            activeTasks.map((t) => (
              <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} showDate onChanged={load} />
            ))}

          {/* Oct 2026 (CB: "I should be able to see on her side, like a completed task
              section"): closed by default, same reasoning as the section's own outer collapse —
              approved tasks are no longer the thing needing attention, so they stay out of the
              way until asked for. */}
          {loadState === "ready" && completedTasks.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setCompletedOpen((v) => !v)}
                aria-expanded={completedOpen}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-black/[0.02] px-3.5 py-2.5 text-sm font-medium text-muted hover:bg-black/[0.04] transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <CheckCircleIcon className="h-3.5 w-3.5" />
                  Completed <span className="text-foreground font-semibold">({completedTasks.length})</span>
                </span>
                <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${completedOpen ? "rotate-180" : ""}`} />
              </button>
              {completedOpen &&
                completedTasks.map((t) => (
                  <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} showDate onChanged={load} />
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
