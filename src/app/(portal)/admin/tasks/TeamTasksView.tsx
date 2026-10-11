"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO, TeamDateTasksRowDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import PayrollPeriodSwitcher from "@/components/PayrollPeriodSwitcher";
import { ChecklistIcon, ChevronDownIcon } from "@/components/icons";
import { getPayrollPeriod, getCurrentPayrollPeriodOffset } from "@/lib/week";

type LoadState = "loading" | "ready" | "error" | "empty";
type StatusFilter = "all" | "needsAction" | "awaitingReview" | "approved";

const NEEDS_ACTION_STATUSES: DateTaskDTO["status"][] = ["ASSIGNED", "IN_PROGRESS", "RETURNED"];

function matchesFilter(task: DateTaskDTO, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needsAction") return NEEDS_ACTION_STATUSES.includes(task.status);
  if (filter === "awaitingReview") return task.status === "AWAITING_REVIEW";
  return task.status === "APPROVED";
}

// Same local-copy convention every other consumer of "initials from a name" already follows in
// this app (see AttendanceAdminView.tsx's own copy of this exact function).
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}

/**
 * Team Tasks — every active team member's own tasks for one pay period, in one place. CB, Oct
 * 2026, on the existing per-date task panels and My Tasks' own reviewer tab: "they probably
 * should be like a sub drop-down menu on my tasks... for like the admin's team member tasks...
 * so we could see the team members task... holistic with all the different team members with
 * all the different tasks." Approved as its own standalone page (next to Team Members/Reports in
 * the admin nav, not a toggle inside My Tasks) via a mockup CB signed off on directly: "it does
 * feel right. I do like it." Two specific calls from that approval, both followed exactly below:
 * cards start collapsed, and plain alphabetical ordering (already how listTeamDateTasksForPeriod
 * orders its own roster) needs no separate pinning logic.
 *
 * Reuses the same DateTaskRow card every other task list in this app already uses
 * (showEmployee=false since this page already names the employee in its own card header;
 * canReview=true since an admin/supervisor opening this page is exactly who assertCanAssignTasks
 * already lets approve/return any of these tasks).
 *
 * `scope` mirrors AttendanceAdminView's own prop (same isAdmin split on the server page) — drives
 * only this page's copy, since listTeamDateTasksForPeriod itself is what actually narrows a
 * Supervisor down to their own direct reports.
 */
export default function TeamTasksView({ scope, viewerId }: { scope: "all" | "team"; viewerId: string }) {
  const [offset, setOffset] = useState(getCurrentPayrollPeriodOffset);
  const [rows, setRows] = useState<TeamDateTasksRowDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<StatusFilter>("all");
  // Collapsed by default (CB: "The card should start... collapsed by default and then it could
  // expand it") — a card is expanded only once its own employeeId is in this set, never the
  // reverse, so a freshly-loaded period always opens with every card closed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const period = getPayrollPeriod(offset);

  async function load() {
    setLoadState("loading");
    try {
      const params = new URLSearchParams({ start: period.start, end: period.end });
      const res = await fetch(`/api/date-tasks/team?${params}`);
      if (!res.ok) throw new Error();
      const data: { rows: TeamDateTasksRowDTO[] } = await res.json();
      setRows(data.rows);
      setLoadState(data.rows.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function toggleExpanded(employeeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  const allTasks = rows.flatMap((r) => r.tasks);
  const needsActionCount = allTasks.filter((t) => matchesFilter(t, "needsAction")).length;
  const awaitingReviewCount = allTasks.filter((t) => matchesFilter(t, "awaitingReview")).length;
  const approvedCount = allTasks.filter((t) => matchesFilter(t, "approved")).length;

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="page-title text-2xl">Team Tasks</h1>
        <p className="text-sm text-muted mt-0.5">
          {scope === "team"
            ? "Your own team's tasks for a pay period, in one place."
            : "Every team member's tasks for a pay period, in one place."}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <PayrollPeriodSwitcher offset={offset} onOffsetChange={setOffset} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted">
          <LegendSwatch color="#b45309" label="Needs action" />
          <LegendSwatch color="#047857" label="Awaiting review" />
          <LegendSwatch color="var(--ttc-pink-ink)" label="Approved" />
        </div>
      </div>

      {loadState === "ready" && (
        <div className="flex flex-wrap gap-1.5 bg-black/[0.04] rounded-full p-1 mb-4 w-fit">
          {(
            [
              { key: "all", label: "All", count: allTasks.length },
              { key: "needsAction", label: "Needs action", count: needsActionCount },
              { key: "awaitingReview", label: "Awaiting review", count: awaitingReviewCount },
              { key: "approved", label: "Approved", count: approvedCount },
            ] as { key: StatusFilter; label: string; count: number }[]
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-sm font-semibold rounded-full px-4 py-1.5 transition-colors ${
                filter === f.key ? "bg-surface text-accent-ink shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      )}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load team tasks. Please try again or contact HR.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
          <ChecklistIcon className="h-8 w-8 text-muted/60" />
          {scope === "team" ? "No active team members on your team yet." : "No active team members yet."}
        </div>
      )}

      {loadState === "ready" && (
        <div className="space-y-2.5">
          {rows.map((row) => {
            const filteredTasks = row.tasks.filter((t) => matchesFilter(t, filter));
            // Away from the "All" filter, a card with nothing matching simply isn't part of the
            // answer to "who needs a review right now" (etc.) — hidden rather than shown empty.
            if (filter !== "all" && filteredTasks.length === 0) return null;

            const needsAction = row.tasks.filter((t) => matchesFilter(t, "needsAction")).length;
            const awaitingReview = row.tasks.filter((t) => matchesFilter(t, "awaitingReview")).length;
            const allCaughtUp = row.tasks.length === 0;
            // A specific filter is itself a request to see those exact tasks — forcing every
            // matching card open means picking a filter chip never requires also clicking every
            // card by hand to actually see what it found. "All" keeps the real collapsed/expanded
            // state so the page still opens collapsed by default, per CB's own call above.
            const isExpanded = filter !== "all" || expanded.has(row.employeeId);

            return (
              <div key={row.employeeId} className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleExpanded(row.employeeId)}
                  disabled={filter !== "all"}
                  aria-expanded={isExpanded}
                  className="w-full flex items-center gap-3.5 px-5 py-3.5 text-left hover:bg-black/[0.02] transition-colors disabled:hover:bg-transparent"
                >
                  {row.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                    <img
                      src={row.avatarUrl}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
                    />
                  ) : (
                    <span
                      className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                      style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
                    >
                      {initialsOf(row.name) || "?"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{row.name}</p>
                    <p className="text-xs text-muted truncate">{row.jobTitle}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {needsAction > 0 && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 whitespace-nowrap">
                        {needsAction} needs action
                      </span>
                    )}
                    {awaitingReview > 0 && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-emerald-100 text-emerald-800 whitespace-nowrap">
                        {awaitingReview} awaiting review
                      </span>
                    )}
                    {allCaughtUp && <span className="text-xs text-muted">All caught up</span>}
                  </div>
                  {filter === "all" && (
                    <ChevronDownIcon
                      className={`h-3.5 w-3.5 text-muted shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                  )}
                </button>

                {isExpanded && filteredTasks.length > 0 && (
                  <div className="border-t border-border bg-black/[0.012] p-3.5 space-y-2.5">
                    {filteredTasks.map((t) => (
                      <DateTaskRow key={t.id} task={t} viewerId={viewerId} canReview showDate onChanged={load} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
