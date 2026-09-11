"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * The admin/supervisor side of a per-date task list — sits alongside TeamNotesThread inside
 * one open date chip on TeamAvailabilityCards. CB, Sept 2026: "I like how we have a texting
 * feature but I feel like we should be also able to push different tasks within that specific
 * day." Two-way, not a plain checklist: an admin/supervisor pushes a task, the employee marks
 * it done on their own dashboard (DateTasksSection), and it only leaves this list once an
 * admin/supervisor confirms it here — "Approve" — or sends it back for another pass —
 * "Send back."
 *
 * Fetches this employee's full task list and filters to `taskDate` client-side rather than a
 * dedicated by-date endpoint — the same list already backs the employee's own dashboard
 * section, and one employee's total task count is small enough that a second endpoint isn't
 * worth the extra round trip.
 */
export default function DateTasksPanel({ employeeId, taskDate }: { employeeId: string; taskDate: string }) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/date-tasks/${employeeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskDate, description }),
      });
      if (res.ok) {
        setDescription("");
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function act(taskId: string, action: "approve" | "reopen") {
    setBusyId(taskId);
    try {
      await fetch(`/api/date-tasks/${taskId}/${action}`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="p-3.5 space-y-2 max-h-[16rem] overflow-y-auto">
        {loadState === "loading" && <div className="h-9 rounded-lg bg-black/[0.04] animate-pulse" />}
        {loadState === "error" && <p className="text-sm text-accent">Unable to load tasks. Please try again.</p>}
        {loadState === "ready" && tasks.length === 0 && (
          <p className="text-sm text-muted">No tasks pushed for this date yet.</p>
        )}
        {loadState === "ready" &&
          tasks.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <p className={`text-sm ${t.status === "APPROVED" ? "line-through text-muted" : ""}`}>{t.description}</p>
                <p className="text-xs text-muted mt-0.5">
                  {t.status === "PENDING" && "Not started yet"}
                  {t.status === "COMPLETED" && `Marked done — awaiting your confirmation`}
                  {t.status === "APPROVED" && `Confirmed`}
                </p>
              </div>
              {t.status === "COMPLETED" && (
                <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
                  <button
                    onClick={() => act(t.id, "approve")}
                    disabled={busyId === t.id}
                    className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => act(t.id, "reopen")}
                    disabled={busyId === t.id}
                    className="text-xs font-medium text-muted hover:text-accent-ink disabled:opacity-50"
                  >
                    Send back
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>

      <form onSubmit={addTask} className="border-t border-border p-3 flex items-center gap-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Push a task for this date…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={submitting || !description.trim()}
          className="btn-primary text-sm px-3.5 py-2 shrink-0 disabled:opacity-60"
        >
          {submitting ? "Adding…" : "Add"}
        </button>
      </form>
    </div>
  );
}
