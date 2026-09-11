"use client";

import { useEffect, useState } from "react";
import type { DateTaskDTO } from "@/types";
import { DownloadIcon } from "@/components/icons";

type LoadState = "loading" | "ready" | "error";

/** "Fri, Oct 9" — same short weekday+month+day shape used for availability date chips. */
function formatTaskDate(taskDate: string): string {
  const [y, m, d] = taskDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The employee-facing half of the date-task feature — CB, Sept 2026: "we should be also able
 * to push different tasks within that specific day... on the receiving end, they would see it
 * on their main dashboard." An admin/supervisor pushes a task from a date's card
 * (DateTasksPanel); it shows up here until the employee marks it done, and then it stays
 * listed as "Pending review" until an admin/supervisor confirms it there — a completed task
 * isn't finished from the employee's side alone.
 *
 * Approved tasks drop out of this list entirely (nothing left here needs their attention), and
 * the whole section disappears once there's nothing PENDING or COMPLETED — same "shows while
 * true" shape as the dashboard's other attention sections.
 */
export default function DateTasksSection({ className, employeeId }: { className?: string; employeeId: string }) {
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

  // Best-effort, optional section — an error here or a genuinely empty list just means nothing
  // to show, not a broken dashboard.
  if (loadState === "error" || (loadState === "ready" && tasks.length === 0)) return null;

  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Your tasks</h2>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {loadState === "loading" && (
          <div className="p-4">
            <div className="h-10 rounded-lg bg-black/[0.04] animate-pulse" />
          </div>
        )}
        {loadState === "ready" &&
          tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm truncate">{t.description}</p>
                <p className="text-xs text-muted mt-0.5">
                  {formatTaskDate(t.taskDate)}
                  {t.status === "COMPLETED" ? " · Waiting for confirmation" : ` · From ${t.createdByName}`}
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
              {t.status === "PENDING" ? (
                <button
                  onClick={() => markDone(t.id)}
                  disabled={busyId === t.id}
                  className="btn-primary text-xs px-3 py-1.5 shrink-0 disabled:opacity-60"
                >
                  {busyId === t.id ? "…" : "Mark done"}
                </button>
              ) : (
                <span className="text-xs font-medium text-amber-700 shrink-0">Pending review</span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
