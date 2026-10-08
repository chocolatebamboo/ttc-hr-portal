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

/** "Sep 9, 3:45 PM" — same shape TeamNotesThread's formatNoteTime used for message timestamps.
 *  Also used for the Approved attribution line below (same "Month day, time" shape fits both). */
function formatCommentTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** Same small local helper every other team-facing list in this app already has its own copy of
 *  (TeamScheduleView, AdminHomeHero, etc.) — not worth a shared util for two initials. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
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
// Oct 2026 (CB, on this card's all-amber look: "that yellow background... is kind of throwing
// me off... once it's complete, I want the background to be green... cause it's gonna be
// reviewed by either Sean or Daijour"): AWAITING_REVIEW now gets its own green tone
// (STATUS_TONE.IN_REVIEW) instead of sharing amber with ASSIGNED/IN_PROGRESS — amber now means
// only "still needs the team member's own action," green means "out of their hands, waiting on
// a reviewer." See status-tone.ts's own doc comment on IN_REVIEW for why this is scoped to this
// one status rather than folded into the app's general 4-tone system.
const TASK_TONE: Record<DateTaskDTO["status"], { from: string; to: string }> = {
  ASSIGNED: STATUS_TONE.PENDING,
  IN_PROGRESS: STATUS_TONE.PENDING,
  AWAITING_REVIEW: STATUS_TONE.IN_REVIEW,
  APPROVED: STATUS_TONE.APPROVED,
  RETURNED: STATUS_TONE.DENIED,
};

// Same onColor text-color convention AvailabilityStatusPill's own ON_COLOR_TEXT map uses —
// a solid-white pill with this as its text color, so the badge reads clearly against any of the
// three card hues above instead of a light tint that would wash out against its own gradient.
const STATUS_INK: Record<DateTaskDTO["status"], string> = {
  ASSIGNED: "#b45309", // amber-700
  IN_PROGRESS: "#b45309",
  AWAITING_REVIEW: "#047857", // emerald-700 — matches STATUS_TONE.IN_REVIEW above
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
  showEmployee = false,
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
  /** My Tasks' "Awaiting review" tab (Oct 2026) spans every employee a reviewer covers, not just
   *  one — unlike the date-scoped/own-dashboard panels, which never need this since every row
   *  there is already known to be one specific person's. */
  showEmployee?: boolean;
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

  // Oct 2026 (CB: "I should be able to review what was submitted for the task"): tapping the
  // circle now opens this short optional note + file instead of submitting instantly — see
  // submitComplete below. `celebrating` is the brief post-submit confirmation (CB: "I want like a
  // little animation once you click there to complete it... there needs to have some level of
  // communication for them to say that it's complete") — a local, purely visual beat that holds
  // for a moment before onChanged() refetches and the card settles into its real AWAITING_REVIEW
  // look, not a server-tracked state of its own.
  const [completing, setCompleting] = useState(false);
  const [completeNote, setCompleteNote] = useState("");
  const [completeFile, setCompleteFile] = useState<File | null>(null);
  const completeFileInputRef = useRef<HTMLInputElement | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [downloadingSubmission, setDownloadingSubmission] = useState(false);

  // Oct 2026 (CB, on a long task description making the Home widget "look kind of cluttered"):
  // the description clamps to 2 lines by default with a "Show more" toggle, same as this app's
  // existing line-clamp-2 convention (NotificationBell, AnnouncementsSection). descOverflows is
  // measured once against the CLAMPED height (descExpanded starts false, so the clamp class is
  // already applied on first render) rather than assumed from character count, so a short
  // description with unusually long words never grows a pointless "Show more" link and a long
  // one that happens to fit in 2 lines doesn't either.
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descOverflows, setDescOverflows] = useState(false);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    setDescOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [task.description]);

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

  /** The file left at SUBMIT time (submissionAttachmentKey) — separate from the task's own
   *  original attachment above, which handleDownload still serves. */
  async function handleSubmissionDownload() {
    setDownloadingSubmission(true);
    try {
      const res = await fetch(`/api/date-tasks/${task.id}/submission-download`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingSubmission(false);
    }
  }

  /** Replaces the old instant runAction("submit") — posts whatever note/file was left in the
   *  inline form (both optional; an empty FormData still submits cleanly, same as a bare tap used
   *  to). On success, holds `celebrating` for a beat (see its own doc comment above) before
   *  calling onChanged(), so the brief confirmation is actually visible rather than being
   *  immediately overwritten by the refetch's real AWAITING_REVIEW card. */
  async function submitComplete() {
    setBusy(true);
    setActionError("");
    try {
      const form = new FormData();
      form.set("note", completeNote);
      if (completeFile) form.set("file", completeFile);
      const res = await fetch(`/api/date-tasks/${task.id}/submit`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to update this task. Please try again.");
        return;
      }
      setCompleting(false);
      setCompleteNote("");
      setCompleteFile(null);
      if (completeFileInputRef.current) completeFileInputRef.current.value = "";
      setCelebrating(true);
      window.setTimeout(() => {
        setCelebrating(false);
        onChanged();
      }, 1100);
    } catch {
      setActionError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
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

  // While `celebrating`, the card flashes straight to the green "in review" tone immediately
  // (rather than waiting ~1.1s for onChanged()'s refetch to bring the real AWAITING_REVIEW status
  // back) — see celebrating's own doc comment above.
  const tone = celebrating ? TASK_TONE.AWAITING_REVIEW : TASK_TONE[task.status];
  const ink = celebrating ? STATUS_INK.AWAITING_REVIEW : STATUS_INK[task.status];
  // Own task, not yet a final outcome — the circle control below is tappable; tapping it opens
  // the inline note (below), replacing the old instant-submit click.
  const canTapComplete = isOwnTask && (task.status === "ASSIGNED" || task.status === "IN_PROGRESS" || task.status === "RETURNED");
  const hasSubmission = Boolean(task.submissionNote) || task.hasSubmissionAttachment;

  return (
    <div
      className="rounded-2xl p-4 text-white shadow-sm"
      style={{ background: `linear-gradient(150deg, ${tone.from} 0%, ${tone.to} 100%)` }}
    >
      {celebrating ? (
        // Oct 2026 (CB: "I want like a little animation once you click there to complete it
        // within that circle, but there needs to have some level of communication... that it's
        // complete" — the celebration isn't named after any one reviewer (CB: "I don't want it to
        // say Daijour... it will all depend on whoever approves it"), just a generic confirmation
        // that the tap went through.
        <div className="flex flex-col items-center justify-center gap-1.5 py-5">
          <div
            className="h-14 w-14 rounded-full bg-white flex items-center justify-center shadow-sm"
            style={{ boxShadow: "0 0 0 8px rgba(255,255,255,0.22)" }}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke={ink} strokeWidth="3">
              <path d="m6 12.5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-bold">Submitted</p>
          <p className="text-xs text-white/75">Under review</p>
        </div>
      ) : (
      <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {showEmployee && (
            <div className="flex items-center gap-1.5 mb-1">
              <span className="h-5 w-5 rounded-md bg-white/25 flex items-center justify-center text-[9px] font-extrabold shrink-0">
                {initialsOf(task.employeeName) || "?"}
              </span>
              <span className="text-xs font-bold">{task.employeeName}</span>
            </div>
          )}
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
            <>
              <p
                ref={descRef}
                className={`text-sm text-white/90 mt-1 whitespace-pre-wrap break-words ${
                  descExpanded ? "" : "line-clamp-2"
                }`}
              >
                {task.description}
              </p>
              {descOverflows && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((v) => !v)}
                  className="text-xs font-semibold text-white underline underline-offset-2 decoration-white/50 hover:decoration-white mt-0.5"
                >
                  {descExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}

          {task.status !== "APPROVED" && (
            <p className="text-xs text-white/75 mt-1.5">
              {task.status === "ASSIGNED" && `From ${task.createdByName}`}
              {task.status === "IN_PROGRESS" && `In progress — from ${task.createdByName}`}
              {task.status === "AWAITING_REVIEW" && "Submitted — awaiting review"}
              {task.status === "RETURNED" && `Sent back by ${task.returnedByName ?? "a reviewer"}`}
            </p>
          )}

          {/* Oct 2026 (CB, on the mockup's first pass at this: "make sure that we are... making
              sure that we have it noted about who approved that task"): was a small line folded
              into the generic meta paragraph above ("Confirmed by X") — promoted to its own row
              with a name chip, same visual weight "From X" gets on a freshly Assigned card, so
              who approved it reads just as plainly as who assigned it. */}
          {task.status === "APPROVED" && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="h-5 w-5 rounded-md bg-white/25 flex items-center justify-center text-[9px] font-extrabold shrink-0">
                {initialsOf(task.approvedByName ?? "") || "?"}
              </span>
              <p className="text-sm font-semibold">
                Approved by {task.approvedByName ?? "a reviewer"}
                {task.approvedAt && <span className="font-normal opacity-75"> · {formatCommentTime(task.approvedAt)}</span>}
              </p>
            </div>
          )}

          {task.status === "RETURNED" && task.returnNote && (
            <div className="rounded-lg bg-white/95 px-3 py-2 text-sm text-rose-800 mt-2 shadow-sm">
              {task.returnNote}
            </div>
          )}

          {/* Oct 2026 (CB: "I should be able to review what was submitted for the task"): the
              note/file left at submit time (submitComplete below), shown right on the card for
              whoever reviews it — previously there was nothing captured here at all beyond a
              status flip. Shows for the employee's own view too ("What you submitted"), not just
              the reviewer's, since it's useful either way. Persists through RETURNED (the last
              thing that was actually turned in, alongside the reviewer's returnNote explaining
              why it came back) and APPROVED, not just AWAITING_REVIEW. */}
          {hasSubmission && (
            <div className="rounded-lg bg-white/95 px-3 py-2 mt-2 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-0.5">
                What {isOwnTask ? "you" : task.employeeName} submitted
              </p>
              {task.submissionNote && (
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">{task.submissionNote}</p>
              )}
              {task.hasSubmissionAttachment && (
                <button
                  onClick={handleSubmissionDownload}
                  disabled={downloadingSubmission}
                  className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-accent-ink underline underline-offset-2"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {task.submissionAttachmentName ?? "Attachment"}
                </button>
              )}
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
              complete would be appropriate" — replaces the old plain "Submit" text button.
              AWAITING_REVIEW sits in between (already turned in, not yet confirmed) as a dimmer,
              non-interactive ring so it doesn't look tappable while it's genuinely out of the
              team member's hands; filled solid white with a check once it's actually Approved.
              Round of QA, CB, on the plain empty ring: "I'm trying to get something that's
              visually... communicate that you could click there to mark as complete" — a first
              pass stacked a "Tap to complete" label underneath the whole card, which she then
              rejected on sight ("I don't like how it's reading like underneath the bottom like
              that... there isn't so much blank space, but then... it fits properly" / "maybe
              Option B [pulsing dashed ring] would be best... tap to complete wording show up
              briefly and then it disappears"). What's below is that final shape: the label and
              ring stay in this same right-side column they always sat in — no new row, no extra
              card height — the label fades in, holds long enough to read, then fades out on its
              own (tap-hint-label, globals.css), leaving a softly pulsing dashed ring
              (tap-hint-ring) as the lasting "something happens here" cue. A reduced-motion
              viewer gets neither animation — see globals.css's own comment on why the label
              just stays put rather than disappearing silently for them. */}
          {canTapComplete && (
            <div className="flex items-center gap-1.5">
              {!completing && (
                <span className="tap-hint-label max-w-[46px] text-right text-[9px] font-bold uppercase leading-tight tracking-wide text-white">
                  Tap to complete
                </span>
              )}
              <button
                type="button"
                onClick={() => setCompleting((v) => !v)}
                aria-label={completing ? "Close the complete-task note" : "Tap to mark this task complete"}
                title={completing ? "Cancel" : "Tap to mark complete"}
                aria-expanded={completing}
                className={`${completing ? "bg-white/25" : "tap-hint-ring"} flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-white/85 transition-colors hover:bg-white/15 active:bg-white/25`}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="white" strokeWidth="3" strokeOpacity="0.9">
                  <path d="m5 13 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
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

      {/* Oct 2026 (CB: "I don't see where you could click it... have like a check mark to say
          that it's complete"): the note + optional file left right here, instead of the old
          instant click-to-submit — both stay optional, so Mark complete with nothing typed still
          behaves exactly like the old bare tap. */}
      {completing && (
        <div className="mt-2.5 rounded-xl bg-white/14 p-2.5 space-y-2">
          <textarea
            value={completeNote}
            onChange={(e) => setCompleteNote(e.target.value)}
            placeholder="What did you do? (optional)"
            rows={2}
            className="w-full rounded-lg border border-white/30 bg-white/95 px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <input
                ref={completeFileInputRef}
                type="file"
                onChange={(e) => setCompleteFile(e.target.files?.[0] ?? null)}
                className="text-xs text-white/80 file:mr-2 file:rounded-md file:border-0 file:bg-white/20 file:px-2 file:py-1 file:text-xs file:font-medium file:text-white max-w-[9rem]"
              />
              {completeFile && (
                <button
                  type="button"
                  onClick={() => {
                    setCompleteFile(null);
                    if (completeFileInputRef.current) completeFileInputRef.current.value = "";
                  }}
                  className="text-xs text-white/80 hover:text-white shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setCompleting(false);
                  setCompleteNote("");
                  setCompleteFile(null);
                  if (completeFileInputRef.current) completeFileInputRef.current.value = "";
                }}
                disabled={busy}
                className="text-xs font-semibold text-white/85 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitComplete}
                disabled={busy}
                className="text-xs font-semibold rounded-full px-3.5 py-1.5 bg-white disabled:opacity-50"
                style={{ color: ink }}
              >
                {busy ? "Submitting…" : "Mark complete"}
              </button>
            </div>
          </div>
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
      </>
      )}
    </div>
  );
}
