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
                          </span>
            {/* QA pass (Sept 2026): a simple priority flag — deliberately just this one badge,
                shown only when URGENT, rather than a NORMAL badge nobody needs to see. Same
                solid-white-pill treatment as the status badge, rose text stays constant
                regardless of the card's own tone so "urgent" always reads the same. */}
            {task.priority === "URGENT" && (
              <span className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold shrink-0 text-rose-700 shadow-sm">
                Urgent
              </span>
            )}
          </div>

          {showDate && <p className="text-xs text-white/75 mt-0.5">{formatTaskDate(task.taskDate)}</p>}

          {task.description && (
            <p className="text-sm text-white/90 mt-1 whitespace-pre-wrap break-words">{task.description}</p>
          )}

          <p className="text-xs text-white/75 mt-1.5">
            {task.status === "ASSIGNED" && `From ${task.createdByName}`}
            {task.status === "IN_PROGRESS" && `In progress — from ${task.createdByName}`}
            {task.status === "AWAITING_REVIEW" && "Submitted — awaiting review"}
            {task.status === "APPROVED" && `Confirmed by ${task.approvedByName ?? "a reviewer"}`}
            {task.status === "RETURNED" && `Sent back by ${task.returnedByName ?? "a reviewer"}`}
          </p>

          {task.status === "RETURNED" && task.returnNote && (
            <div className="rounded-lg bg-white/95 px-3 py-2 text-sm text-rose-800 mt-2 shadow-sm">
              {task.returnNote}
            </div>
          )}

          {task.hasAttachment && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-white underline underline-offset-2 decoration-white/50 hover:decoration-white"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              {task.attachmentName ?? "Attachment"}
            </button>
          )}

          {actionError && <p className="text-xs font-medium text-white mt-1.5 bg-black/15 rounded px-2 py-1 inline-block">{actionError}</p>}

          {isOwnTask && task.status === "ASSIGNED" && (
            <button
              onClick={() => runAction("start")}
              disabled={busy}
              className="mt-2 block text-xs font-semibold text-white underline underline-offset-2 decoration-white/50 hover:decoration-white disabled:opacity-50"
            >
              Start this task
            </button>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {/* CB, Sept 2026: "a bubble or a circle or something like that to confirm that it's
              complete would be appropriate" — replaces the old plain "Submit" text button. An
              empty ring while there's still something to do, filled solid white with a check
              once it's actually Approved; AWAITING_REVIEW sits in between (already turned in,
              not yet confirmed) as a dimmer, non-interactive ring so it doesn't look tappable
              while it's genuinely out of the team member's hands. */}
          {canTapComplete && (
            <button
              type="button"
              onClick={() => runAction("submit")}
              disabled={busy}
              aria-label="Mark this task complete"
              title="Mark complete"
              className="h-9 w-9 rounded-full border-2 border-white/70 hover:bg-white/15 active:bg-white/25 transition-colors disabled:opacity-50 shrink-0"
            />
          )}
          {isOwnTask && task.status === "AWAITING_REVIEW" && (
            <div
              className="h-9 w-9 rounded-full border-2 border-white/40 flex items-center justify-center shrink-0"
              aria-label="Awaiting review"
              title="Awaiting review"
            >
              <span className="h-2 w-2 rounded-full bg-white/70" />
            </div>
          )}
          {task.status === "APPROVED" && (
            <div
              className="h-9 w-9 rounded-full bg-white flex items-center justify-center shadow-sm shrink-0"
              aria-label="Complete"
              title="Complete"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke={ink} strokeWidth="2.4">
                <path d="m6 12.5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          {canReview && task.status === "AWAITING_REVIEW" && (
            <>
              <button
                onClick={() => runAction("approve")}
                disabled={busy}
                className="text-xs font-semibold text-white bg-white/20 hover:bg-white/30 rounded-full px-3 py-1 disabled:opacity-50 whitespace-nowrap"
              >
                Approve
              </button>
              <button
                onClick={() => setReturning((v) => !v)}
                disabled={busy}
                className="text-xs font-medium text-white/85 hover:text-white disabled:opacity-50 whitespace-nowrap"
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
            className="flex-1 rounded-lg border border-white/40 bg-white/95 px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white"
          />
          <button
            onClick={submitReturn}
            disabled={busy || !returnNote.trim()}
            className="text-xs font-semibold text-white bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 whitespace-nowrap disabled:opacity-50"
          >
            Send back
          </button>
        </div>
      )}

      {/* CB, round four: "I don't like how the comment is like above it. I want to be able to
          make a comment under that specific task so that we have a conversation within that." —
          this toggle and the thread it opens are pinned directly under THIS task's own content
          (title/description/status/actions above, nothing else in between), and the copy says so
          explicitly rather than just "Comment" so it never reads as a general/shared thread.
          QA pass, CB: "I don't like how the icon looks for the comment on this task" — this is
          the same real ChatIcon used everywhere else messaging shows up in this app (My Messages,
          etc.), not a placeholder glyph. */}
      <button
        onClick={() => setCommentsOpen((v) => !v)}
        className="mt-3 pt-3 border-t border-white/25 w-full flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white"
      >
        <ChatIcon className="h-3.5 w-3.5" />
        {task.commentCount > 0
          ? `${task.commentCount} comment${task.commentCount === 1 ? "" : "s"} on this task`
          : "Comment on this task"}
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${commentsOpen ? "rotate-180" : ""}`} />
      </button>

      {commentsOpen && (
        <div className="mt-2 rounded-xl bg-white/15 overflow-hidden">
          <div className="p-3 space-y-2.5 max-h-64 overflow-y-auto">
            {commentLoadState === "loading" && <div className="h-8 rounded-lg bg-white/10 animate-pulse" />}
            {commentLoadState === "error" && (
              <p className="text-xs text-white">Unable to load comments. Please try again.</p>
            )}
            {commentLoadState === "ready" && comments.length === 0 && (
              <p className="text-xs text-white/75">No comments yet — this is where the conversation about this task will show up.</p>
            )}
            {commentLoadState === "ready" &&
              comments.map((c) => {
                const mine = c.authorId === viewerId;
                return (
                  <div key={c.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 ${mine ? "text-white" : "bg-white/95 text-foreground"}`}
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

          <form onSubmit={sendComment} className="border-t border-white/20 p-2.5 space-y-1.5">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Reply about this task…"
              rows={2}
              className="w-full rounded-lg border border-white/30 bg-white/95 px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white resize-none"
            />
            {commentError && <p className="text-xs text-white">{commentError}</p>}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <input
                  ref={commentFileInputRef}
                  type="file"
                  onChange={(e) => setCommentFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-white/80 max-w-[8rem]"
                />
                {commentFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setCommentFile(null);
                      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
                    }}
                    className="text-xs text-white/80 hover:text-white shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={sendingComment || (!commentBody.trim() && !commentFile)}
                className="text-xs font-semibold shrink-0 rounded-full px-3 py-1.5 bg-white disabled:opacity-50"
                style={{ color: ink }}
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
