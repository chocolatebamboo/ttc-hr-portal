"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO } from "@/types";
import { DownloadIcon } from "@/components/icons";

type LoadState = "loading" | "ready" | "error";

/**
 * The employee's OWN view of one date's pushed tasks, scoped to wherever that date already
 * comes up for them — currently just AvailabilityCalendar's SubmissionDetail panel, alongside
 * that same date's TeamNotesThread conversation. CB, Sept 2026: "on the availability tab...
 * I probably want some of the features of what was approved or what was selected to reflect on
 * the availability page, especially on the mobile side" — and, on tasks specifically: "once we
 * create the task on the receiving end, they'll be able to probably click on... a check mark
 * just to see that they completed" it. That check-mark flow already existed on the dashboard's
 * "Your tasks" section (DateTasksSection) — this is the same underlying data and the same
 * POST /api/date-tasks/[id]/complete, just a compact, single-date-scoped read/mark-done view
 * that lives right where an employee is already looking at that specific date, rather than
 * asking them to go find it in a separate global list.
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  async function markDone(taskId: string) {
    setBusyId(taskId);
    try {
      await fetch(`/api/date-tasks/${taskId}/complete`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(taskId: string) {
    setDownloadingId(taskId);
    try {
      const res = await fetch(`/api/date-tasks/${taskId}/download`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="p-3.5 space-y-2 max-h-[16rem] overflow-y-auto">
        {loadState === "loading" && <div className="h-9 rounded-lg bg-black/[0.04] animate-pulse" />}
        {loadState === "error" && <p className="text-sm text-accent">Unable to load tasks. Please try again.</p>}
        {loadState === "ready" && tasks.length === 0 && (
          <p className="text-sm text-muted">No tasks for this date yet.</p>
        )}
        {loadState === "ready" &&
          tasks.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <p className={`text-sm ${t.status === "APPROVED" ? "line-through text-muted" : ""}`}>{t.description}</p>
                <p className="text-xs text-muted mt-0.5">
                  {t.status === "PENDING" && `From ${t.createdByName}`}
                  {t.status === "COMPLETED" && "Waiting for confirmation"}
                  {t.status === "APPROVED" && "Confirmed"}
                </p>
                {t.hasAttachment && (
                  <button
                    onClick={() => handleDownload(t.id)}
                    disabled={downloadingId === t.id}
                    className="mt-1 flex items-center gap-1.5 text-xs font-medium text-accent-ink underline"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    {t.attachmentName ?? "Attachment"}
                  </button>
                )}
              </div>
              {t.status === "PENDING" && (
                <button
                  onClick={() => markDone(t.id)}
                  disabled={busyId === t.id}
                  className="btn-primary text-xs px-3 py-1.5 shrink-0 disabled:opacity-60"
                >
                  {busyId === t.id ? "…" : "Mark done"}
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
