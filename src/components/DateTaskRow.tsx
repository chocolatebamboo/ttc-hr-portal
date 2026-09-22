"use client";

import { useEffect, useRef, useState } from "react";
import type { DateTaskCommentDTO, DateTaskDTO } from "@/types";
import { ChatIcon, ChevronDownIcon, DownloadIcon } from "@/components/icons";
import { STATUS_TONE } from "@/lib/status-tone";

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

// QA pass (Sept 2026), CB: task status should follow the same brand color language the
// availability cards already use (see src/lib/status-tone.ts) — amber for anything still
// outstanding, the brand pink for a confirmed/approved outcome, rose for sent-back — rather than
// its own separate blue/emerald scheme that reads as an unrelated feature.
const STATUS_LABEL: Record<DateTaskDTO["status"], string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  AWAITING_REVIEW: "Awaiting review",
  APPROVED: "Approved",
  RETURNED: "Returned",
};

// CB, Sept 2026: "I don't like how the white background and whatnot... it needs to be like an
// appropriate colored background" — this row is now a full colored card, same gradient-per-
// status treatment MyAvailabilityPreview's own cards already use, instead of a plain white row.
// Outstanding work (anything short of a final outcome) reads amber; a confirmed Approved reads
// the brand pink; a Returned task reads rose, same "needs attention again" tone Denied uses
// elsewhere. Text/badges on top of this switch to the same solid-white-pill-plus-tone-text
// treatment AvailabilityStatusPill's onColor prop already established for this exact problem —
// a light tint badge (the old bg-amber-100 text-amber-800 etc.) would nearly vanish against a
// same-hue gradient background.
const TASK_TONE: Record<DateTaskDTO["status"], { from: string; to: string }> = {
  ASSIGNED: STATUS_TONE.PENDING,
  IN_PROGRESS: STATUS_TONE.PENDING,
  AWAITING_REVIEW: STATUS_TONE.PENDING,
  APPROVED: STATUS_TONE.APPROVED,
  RETURNED: STATUS_TONE.DENIED,
};

// Same onColor text-color convention AvailabilityStatusPill's own ON_COLOR_TEXT map uses —
// a solid-white pill with this as its text color, so the badge reads clearly against any of the
// three card hues above instead of a light tint that would wash out against its own gradient.
const STATUS_INK: Record<DateTaskDTO["status"], string> = {
  ASSIGNED: "#b45309", // amber-700
  IN_PROGRESS: "#b45309",
  AWAITING_REVIEW: "#b45309",
  APPROVED: "var(--ttc-pink-ink)",
  RETURNED: "#be123c", // rose-700
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

  const tone = TASK_TONE[task.status];
  const ink = STATUS_INK[task.status];
  // Own task, not yet a final outcome — the circle control below is tappable and its click
  // submits the task, same action the old plain "Submit" button used to trigger.
  const canTapComplete = isOwnTask && (task.status === "ASSIGNED" || task.status === "IN_PROGRESS" || task.status === "RETURNED");

  return (
    <div
      className="rounded-2xl p-4 text-white shadow-sm"
      style={{ background: `linear-gradient(150deg, ${tone.from} 0%, ${tone.to} 100%)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-semibold ${task.status === "APPROVED" ? "line-through text-white/70" : ""}`}>
              {task.title}
            </p>
            <span
              className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold shrink-0 shadow-sm"
              style={{ color: ink }}
            >
              {STATUS_LABEL[task.status]}
