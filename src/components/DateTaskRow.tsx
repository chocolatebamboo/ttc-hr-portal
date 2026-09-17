"use client";

import { useEffect, useRef, useState } from "react";
import type { DateTaskCommentDTO, DateTaskDTO } from "@/types";
import { ChatIcon, ChevronDownIcon, DownloadIcon } from "@/components/icons";

type CommentLoadState = "idle" | "loading" | "ready" | "error";

/** "Fri, Oct 9" — same short weekday+month+day shape DateTasksSection's own formatter used. */
function formatTaskDate(taskDate: string): string {
  const [y, m, d] = taskDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "Sep 9, 3:45 PM" — same shape TeamNotesThread's formatNoteTime used for message timestamps. */
function formatCommentTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

const STATUS_BADGE: Record<DateTaskDTO["status"], { label: string; className: string }> = {
  ASSIGNED: { label: "Assigned", className: "bg-blue-100 text-blue-800" },
  IN_PROGRESS: { label: "In progress", className: "bg-amber-100 text-amber-800" },
  AWAITING_REVIEW: { label: "Awaiting review", className: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  RETURNED: { label: "Returned", className: "bg-rose-100 text-rose-800" },
};

/**
 * One task's full row — title, status, whichever actions apply to whoever's looking at it, and
 * its own expandable comment thread. Correction brief #2 (Sept 2026), CB: "Redesign this area
 * into an actual task-management workflow." Pulled out as a shared component so the status-
 * badge/action-button/comment-thread logic exists exactly once instead of three times across
 * DateTasksPanel (admin/supervisor), MyDateTasksPanel (employee, one date), and DateTasksSection
 * (employee, dashboard-wide) — see each of those for how they wire this up.
 *
 * Also replaces the standalone per-date TeamNotesThread "Conversation" section that used to sit
 * next to a date's task list on TeamAvailabilityCards / AvailabilityCalendar / TeamScheduleView /
 * ScheduleView — each task now carries its own comment thread instead of every task on a date
 * sharing one general conversation, so a comment is always clearly about one specific task.
 */
export default function DateTaskRow({
  task,
  viewerId,
  canReview,
  showDate = false,
  onChanged,
}: {
  task: DateTaskDTO;
  /** The signed-in viewer's own employee id — decides which side a comment bubble renders on,
   *  and, via task.employeeId === viewerId, whether the Start/Submit actions apply here. */
  viewerId: string;
  /** Admin, or the task's own employee's supervisor — may Approve / Send back a task that's
   *  AWAITING_REVIEW. The server enforces this independently either way. */
  canReview: boolean;
  /** DateTasksSection's dashboard-wide list shows which date each task is for; the date-scoped
   *  panels (DateTasksPanel, MyDateTasksPanel) already sit inside one date and don't repeat it. */
  showDate?: boolean;
  /** Fires after any action changes this task (status, comment count) — lets the parent list
   *  refetch so every row stays in sync, not just this one. */
  onChanged: () => void;
}) {
  const isOwnTask = task.employeeId === viewerId;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState("");

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<DateTaskCommentDTO[]>([]);
  const [commentLoadState, setCommentLoadState] = useState<CommentLoadState>("idle");
  const [commentBody, setCommentBody] = useState("");
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [sendingComment, setSendingComment] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [downloadingCommentId, setDownloadingCommentId] = useState<string | null>(null);
  const commentFileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadComments() {
    setCommentLoadState("loading");
    try {
      const res = await fetch(`/api/date-tasks/${task.id}/comments`);
      if (!res.ok) throw new Error();
      const data: { comments: DateTaskCommentDTO[] } = await res.json();
      setComments(data.comments);
      setCommentLoadState("ready");
    } catch {
      setCommentLoadState("error");
    }
  }

  useEffect(() => {
    if (commentsOpen && commentLoadState === "idle") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsOpen]);

  async function runAction(path: "start" | "submit" | "approve") {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/date-tasks/${task.id}/${path}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to update this task. Please try again.");
        return;
      }
      onChanged();
    } catch {
      setActionError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn() {
    if (!returnNote.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/date-tasks/${task.id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: returnNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to send this task back. Please try again.");
        return;
      }
      setReturning(false);
      setReturnNote("");
      if (commentLoadState === "ready") await loadComments();
      onChanged();
    } catch {
      setActionError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/date-tasks/${task.id}/download`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  async function handleCommentDownload(commentId: string) {
    setDownloadingCommentId(commentId);
    try {
      const res = await fetch(`/api/date-tasks/${task.id}/comments/${commentId}/download`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingCommentId(null);
    }
  }

  async function sendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim() && !commentFile) return;
    setSendingComment(true);
    setCommentError("");
    try {
      const form = new FormData();
      form.set("body", commentBody);
      if (commentFile) form.set("file", commentFile);
      const res = await fetch(`/api/date-tasks/${task.id}/comments`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommentError(data.error ?? "Couldn't post that. Please try again.");
        return;
      }
      setCommentBody("");
      setCommentFile(null);
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
      await loadComments();
      onChanged();
    } catch {
      setCommentError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSendingComment(false);
    }
  }

  const badge = STATUS_BADGE[task.status];

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-medium ${task.status === "APPROVED" ? "line-through text-muted" : ""}`}>
              {task.title}
            </p>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${badge.className}`}>
              {badge.label}
            </span>
          </div>

          {showDate && <p className="text-xs text-muted mt-0.5">{formatTaskDate(task.taskDate)}</p>}

          {task.description && (
            <p className="text-sm text-muted mt-1 whitespace-pre-wrap break-words">{task.description}</p>
          )}

          <p className="text-xs text-muted mt-1.5">
            {task.status === "ASSIGNED" && `From ${task.createdByName}`}
            {task.status === "IN_PROGRESS" && `In progress — from ${task.createdByName}`}
            {task.status === "AWAITING_REVIEW" && "Submitted — awaiting review"}
            {task.status === "APPROVED" && `Confirmed by ${task.approvedByName ?? "a reviewer"}`}
            {task.status === "RETURNED" && `Sent back by ${task.returnedByName ?? "a reviewer"}`}
          </p>

          {task.status === "RETURNED" && task.returnNote && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800 mt-2">
              {task.returnNote}
            </div>
          )}

          {task.hasAttachment && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-accent-ink underline"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              {task.attachmentName ?? "Attachment"}
            </button>
          )}

          {actionError && <p className="text-xs text-accent mt-1.5">{actionError}</p>}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {isOwnTask && task.status === "ASSIGNED" && (
            <button onClick={() => runAction("start")} disabled={busy} className="btn-neutral text-xs px-2.5 py-1">
              Start
            </button>
          )}
          {isOwnTask && (task.status === "ASSIGNED" || task.status === "IN_PROGRESS" || task.status === "RETURNED") && (
            <button onClick={() => runAction("submit")} disabled={busy} className="btn-primary text-xs px-2.5 py-1">
              {busy ? "…" : "Submit"}
            </button>
          )}
          {canReview && task.status === "AWAITING_REVIEW" && (
            <>
              <button
                onClick={() => runAction("approve")}
                disabled={busy}
                className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => setReturning((v) => !v)}
                disabled={busy}
                className="text-xs font-medium text-muted hover:text-accent-ink disabled:opacity-50"
              >
                Send back
              </button>
            </>
          )}
        </div>
      </div>

      {returning && (
        <div className="mt-2.5 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={returnNote}
            onChange={(e) => setReturnNote(e.target.value)}
            placeholder="What needs to change?"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={submitReturn}
            disabled={busy || !returnNote.trim()}
            className="btn-neutral text-xs px-3 py-1.5 whitespace-nowrap"
          >
            Send back
          </button>
        </div>
      )}

      <button
        onClick={() => setCommentsOpen((v) => !v)}
        className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-muted hover:text-accent-ink"
      >
        <ChatIcon className="h-3.5 w-3.5" />
        {task.commentCount > 0 ? `${task.commentCount} comment${task.commentCount === 1 ? "" : "s"}` : "Comment"}
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${commentsOpen ? "rotate-180" : ""}`} />
      </button>

      {commentsOpen && (
        <div className="mt-2 rounded-xl border border-border bg-background overflow-hidden">
          <div className="p-3 space-y-2.5 max-h-64 overflow-y-auto">
            {commentLoadState === "loading" && <div className="h-8 rounded-lg bg-black/[0.04] animate-pulse" />}
            {commentLoadState === "error" && (
              <p className="text-xs text-accent">Unable to load comments. Please try again.</p>
            )}
            {commentLoadState === "ready" && comments.length === 0 && (
              <p className="text-xs text-muted">No comments yet.</p>
            )}
            {commentLoadState === "ready" &&
              comments.map((c) => {
                const mine = c.authorId === viewerId;
                return (
                  <div key={c.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 ${mine ? "text-white" : "bg-black/[0.04]"}`}
                      style={mine ? { background: "var(--ttc-blue)" } : undefined}
                    >
                      {!mine && <p className="text-[11px] font-semibold mb-0.5">{c.authorName}</p>}
                      {c.body && <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>}
                      {c.hasAttachment && (
                        <button
                          onClick={() => handleCommentDownload(c.id)}
                          disabled={downloadingCommentId === c.id}
                          className={`mt-1 flex items-center gap-1.5 text-xs font-medium underline ${mine ? "text-white/90" : "text-accent-ink"}`}
                        >
                          <DownloadIcon className="h-3.5 w-3.5" />
                          {c.attachmentName ?? "Attachment"}
                        </button>
                      )}
                      <p className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-muted"}`}>
                        {formatCommentTime(c.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>

          <form onSubmit={sendComment} className="border-t border-border p-2.5 space-y-1.5">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent resize-none"
            />
            {commentError && <p className="text-xs text-accent">{commentError}</p>}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <input
                  ref={commentFileInputRef}
                  type="file"
                  onChange={(e) => setCommentFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-muted max-w-[8rem]"
                />
                {commentFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setCommentFile(null);
                      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
                    }}
                    className="text-xs text-muted hover:text-accent-ink shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={sendingComment || (!commentBody.trim() && !commentFile)}
                className="btn-primary text-xs px-3 py-1.5 shrink-0"
              >
                {sendingComment ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
