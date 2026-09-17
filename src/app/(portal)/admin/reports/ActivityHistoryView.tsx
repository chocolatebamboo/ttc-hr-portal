"use client";

import { useEffect, useState } from "react";
import type { ActivityLogEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";
type EmployeeOption = { id: string; name: string };

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  SHIFT_CREATED: "Shift created",
  SHIFT_CANCELLED: "Shift cancelled",
  SHIFT_REASSIGNED: "Shift reassigned",
  SHIFT_CHANGE_REQUESTED: "Shift change requested",
  SHIFT_CANCELLATION_REQUESTED: "Shift cancellation requested",
  SHIFT_CHANGE_DECLINED: "Shift change declined",
  SHIFT_CANCELLATION_DECLINED: "Shift cancellation declined",
  SHIFT_CANCELLATION_APPROVED: "Shift cancellation approved",
  SHIFT_CHANGE_APPROVED: "Shift change approved",
  AVAILABILITY_APPROVED: "Availability approved",
  AVAILABILITY_DENIED: "Availability denied",
  AVAILABILITY_ADJUSTMENT_PROPOSED: "Availability adjustment proposed",
  AVAILABILITY_ADJUSTMENT_ACCEPTED: "Availability adjustment accepted",
  AVAILABILITY_ADJUSTMENT_DECLINED: "Availability adjustment declined",
  PTO_APPROVED: "PTO approved",
  PTO_DENIED: "PTO denied",
  DATE_TASK_ASSIGNED: "Task assigned",
  DATE_TASK_COMPLETED: "Task completed",
  DATE_TASK_APPROVED: "Task approved",
};

function actionLabel(action: string): string {
  return ACTIVITY_ACTION_LABELS[action] ?? action;
}

export default function ActivityHistoryView() {
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(todayDateKey());
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [entries, setEntries] = useState<ActivityLogEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  async function generate(s: string, e: string, actor: string, act: string) {
    setLoadState("loading");
    setErrorMessage("");
    try {
      const params = new URLSearchParams({ start: s, end: e });
      if (actor) params.set("actorId", actor);
      if (act) params.set("action", act);
      const res = await fetch(`/api/admin/activity?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadState("error");
        setErrorMessage(data.error ?? "Unable to load activity history. Please try again.");
        return;
      }
      setEntries(data);
      setLoadState(data.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
      setErrorMessage("Unable to reach the server. Check your connection and try again.");
    }
  }

  async function loadEmployees() {
    try {
      const res = await fetch("/api/roster/assignable");
      if (!res.ok) return;
      const data = await res.json();
      setEmployees(data.employees ?? []);
    } catch {
      // Non-fatal — the picker just stays empty and the filter still works unfiltered.
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    generate(start, end, actorId, action);
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(start, end, actorId, action);
  }

  function handleActorChange(id: string) {
    setActorId(id);
    generate(start, end, id, action);
  }

  function handleActionChange(act: string) {
    setAction(act);
    generate(start, end, actorId, act);
  }

  const rangeInvalid = end < start;

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-muted mb-4">
        Every shift, availability, PTO, and task decision made in the portal — most recent 200,
        newest first. Narrow by who took the action, what it was, or a date range.
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-surface border border-border rounded-xl p-4 mb-5 flex flex-wrap items-end gap-3"
      >
        <div>
          <label className="block text-sm font-medium mb-1.5">Performed by</label>
          <select
            value={actorId}
            onChange={(ev) => handleActorChange(ev.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent min-w-[160px]"
          >
            <option value="">Anyone</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Action</label>
          <select
            value={action}
            onChange={(ev) => handleActionChange(ev.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent min-w-[180px]"
          >
            <option value="">Any action</option>
            {Object.entries(ACTIVITY_ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Start date</label>
          <input
            type="date"
            required
            value={start}
            onChange={(ev) => setStart(ev.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">End date</label>
          <input
            type="date"
            required
            value={end}
            onChange={(ev) => setEnd(ev.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button type="submit" disabled={rangeInvalid || loadState === "loading"} className="btn-primary text-sm px-5 py-2">
          {loadState === "loading" ? "Loading…" : "Filter"}
        </button>
        {rangeInvalid && <p className="text-xs text-accent basis-full">End date must be on or after the start date.</p>}
      </form>

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">{errorMessage}</div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No activity in this period yet.
        </div>
      )}

      {loadState === "ready" && (
        <div>
          <div className="md:hidden space-y-2.5">
            {entries.map((entry) => (
              <div key={entry.id} className="bg-surface border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{actionLabel(entry.action)}</p>
                    <p className="text-xs text-muted mt-0.5 truncate">{entry.targetLabel}</p>
                  </div>
                  <p className="text-xs text-muted shrink-0 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
                <p className="text-xs text-muted mt-2 border-t border-border pt-2">by {entry.actorName}</p>
                {entry.comment && <p className="text-sm mt-1">{entry.comment}</p>}
              </div>
            ))}
          </div>

          <div className="hidden md:block bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Regarding</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                  <th className="px-4 py-2.5 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2.5 text-muted whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{actionLabel(entry.action)}</td>
                    <td className="px-4 py-2.5">{entry.targetLabel}</td>
                    <td className="px-4 py-2.5 text-muted">{entry.actorName}</td>
                    <td className="px-4 py-2.5 text-muted max-w-xs truncate">{entry.comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
