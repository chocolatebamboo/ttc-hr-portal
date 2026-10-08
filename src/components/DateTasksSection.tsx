"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import { ChevronDownIcon } from "@/components/icons";

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
 * Approved tasks drop out of this list entirely (nothing left here needs their attention), and
 * the whole section disappears once there's nothing left that isn't APPROVED — same "shows while
 * true" shape as the dashboard's other attention sections.
 *
 * Collapsible (CB, Oct 2026: "I don't want it to be too cluttered... I want to make sure that
 * it's collapsible" — this widget sits on Home, above several other sections, so a team member
 * with several tasks assigned was pushing everything below it down the page). Starts open (the
 * common case is one or two tasks, where collapsing by default would just be an extra tap to see
 * them) — the count in the header lets you tell at a glance how many are in there either way.
 */
export default function DateTasksSection({ className, employeeId }: { className?: string; employeeId: string }) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [collapsed, setCollapsed] = useState(false);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/date-tasks/${employeeId}`);
      if (!res.ok) throw new Error();
      const data: { tasks: DateTaskDTO[] } = await res.json();
      setTasks(data.tasks.filter((t) => t.status !== "APPROVED"));
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

  // Best-effort, optional section — an error here or a genuinely empty list just means nothing
  // to show, not a broken dashboard.
  if (loadState === "error" || (loadState === "ready" && tasks.length === 0)) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between mb-2"
      >
        <h2 className="text-sm font-medium text-muted">
          Your tasks{loadState === "ready" && tasks.length > 0 ? ` (${tasks.length})` : ""}
        </h2>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
        />
      </button>
      {!collapsed && (
        <div className="space-y-2.5">
          {loadState === "loading" && <div className="h-16 rounded-2xl bg-black/[0.04] animate-pulse" />}
          {loadState === "ready" &&
            tasks.map((t) => (
              <DateTaskRow key={t.id} task={t} viewerId={employeeId} canReview={false} showDate onChanged={load} />
            ))}
        </div>
      )}
    </div>
  );
}
