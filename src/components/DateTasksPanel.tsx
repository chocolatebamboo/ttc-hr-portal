"use client";

import { useEffect, useRef, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";
import RichTextEditor from "@/components/RichTextEditor";

type LoadState = "loading" | "ready" | "error";

/**
 * The admin/supervisor side of a per-date task list — sits inside one open date chip on
 * TeamAvailabilityCards / TeamScheduleView. CB, Sept 2026: "I like how we have a texting feature
 * but I feel like we should be also able to push different tasks within that specific day."
 *
 * Correction brief #2 (Sept 2026), CB: "Redesign this area into an actual task-management
 * workflow... Remove the large standalone 'Conversation' section currently underneath the
 * tasks." Each pushed task now carries its own title, description, attachment, 5-state
 * lifecycle (ASSIGNED → IN_PROGRESS → AWAITING_REVIEW → APPROVED/RETURNED), and its own
 * expandable comment thread — all rendered by the shared DateTaskRow, with `canReview` always
 * true here since this is inherently the reviewing side.
 *
 * Fetches this employee's full task list and filters to `taskDate` client-side rather than a
 * dedicated by-date endpoint — the same list already backs the employee's own dashboard
 * section, and one employee's total task count is small enough that a second endpoint isn't
 * worth the extra round trip.
 */
export default function DateTasksPanel({
  employeeId,
  taskDate,
  viewerId,
  onColor = false,
  tasksOverride,
  onTasksChanged,
  onExpandTask,
}: {
  employeeId: string;
  taskDate: string;
  /** The signed-in admin/supervisor viewing this panel — passed straight through to DateTaskRow
   *  so its comment thread knows which side of a bubble is "you." */
  viewerId: string;
  /** CB, Sept 2026: "it's blending too much. It's supposed to be white" — true only on
   *  TeamAvailabilityCards' call site, where this panel sits directly on a solid same-hue
   *  gradient card (no white/bordered box behind it) and the default dark "+ Create task"
   *  treatment nearly disappears. TeamScheduleView's own call site sits on a plain bg-surface
   *  card instead, so it leaves this false — same onColor pattern AvailabilityStatusPill already
   *  uses for this exact "same component, two different background contexts" problem. */
  onColor?: boolean;
  /** Round eighteen (desktop click-to-expand on Team Availability/Team Schedule — CB, Nov 2026):
   *  when given, this panel skips its own fetch and renders these tasks instead (already
   *  filtered to this date by the caller). The caller only ever provides this from the one
   *  globally-open date, so there's one shared array behind both this in-place list and that
   *  caller's own side panel — never a second, separately-fetched snapshot of "the same" tasks
   *  that could drift out of sync with it. Omitted by every other caller (DirectMessageThread,
   *  and TeamScheduleView/TeamAvailabilityCards before this round), which keeps fetching and
   *  rendering exactly as they always have. */
  tasksOverride?: DateTaskDTO[];
  /** Pairs with tasksOverride — fires in place of this panel's own load() after an action
   *  changes a task (push, approve, comment…), so the caller can refetch the one shared array
   *  instead of this panel refetching its own separate copy. Required whenever tasksOverride is
   *  given; unused otherwise. */
  onTasksChanged?: () => void;
  /** Threaded straight through to each DateTaskRow as onExpandRequested — see that prop's own
   *  doc comment. Omitted by every caller that hasn't opted into the side-panel expand. */
  onExpandTask?: (task: DateTaskDTO) => void;
}) {
  const [tasks, setTasks] = useState<DateTaskDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // QA pass (Sept 2026): a simple priority flag on assignment — see DateTaskPriority's own doc
  // comment in prisma/schema.prisma. CB, Sept 2026: replaced the "Mark as urgent" checkbox with
  // a proper Normal/Urgent segmented control — the checkbox read as "is this on or off" instead
  // of "which of these two is it," and a bug in an earlier mockup pass had both options able to
  // look selected at once. Only one of the two is ever the active segment.
  const [priority, setPriority] = useState<"NORMAL" | "URGENT">("NORMAL");
  // Round seventeen (CB, Oct 2026: "let's make sure... when it needs to be due as well" — asked
  // directly whether a due date should be required: "Optional"). Two plain date/time inputs
  // rather than one <input type="datetime-local">, matching the mockup CB approved and this
  // form's own existing taskDate (set by whichever date chip this panel is already open on, not
  // asked here) — kept as separate strings and combined into one ISO instant only at submit time.
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // CB, Sept 2026: "the task should look almost like an add-on... a circle with a plus that says
  // create task... a submenu where you could enter in the task" — now that pushing a task has
  // nothing to do with confirming a shift (see TeamAvailabilityCards' own doc comment), the form
  // no longer needs to sit open by default; it's a collapsed, optional add-on the admin opens on
  // purpose, same "+" affordance as the per-date "Add a note" button elsewhere on this card.
  const [showAddForm, setShowAddForm] = useState(false);

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
    // Round eighteen: tasksOverride means the caller already owns this date's fetch (see that
    // prop's own doc comment) — skip this panel's own, so there's never a second, separately
    // loading copy of the same list sitting behind the override.
    if (tasksOverride) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, taskDate, tasksOverride]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setAddError("");
    try {
      const form = new FormData();
      form.set("taskDate", taskDate);
      form.set("title", title);
      form.set("description", description);
      form.set("priority", priority);
      if (dueDate) form.set("dueAt", `${dueDate}T${dueTime || "00:00"}:00`);
      if (file) form.set("file", file);
      const res = await fetch(`/api/date-tasks/${employeeId}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data.error ?? "Unable to add that task. Please try again.");
        return;
      }
      setTitle("");
      setDescription("");
      setFile(null);
      setPriority("NORMAL");
      setDueDate("");
      setDueTime("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setShowAddForm(false);
      // Round eighteen: tasksOverride means the caller owns the fetch — let it refetch the one
      // shared array instead of this panel loading its own separate copy (see tasksOverride's
      // own doc comment above).
      if (tasksOverride) onTasksChanged?.();
      else await load();
    } catch {
      setAddError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* CB, Sept 2026: "it needs to be like an appropriate colored background" — each task is
          now its own colored card (DateTaskRow), so this list is a stack of independent cards
          rather than rows sharing one white box divided by hairlines. */}
      <div className="space-y-2.5 max-h-[28rem] overflow-y-auto p-0.5">
        {!tasksOverride && loadState === "loading" && <div className="h-16 rounded-2xl bg-black/[0.04] animate-pulse" />}
        {!tasksOverride && loadState === "error" && <p className="text-sm text-accent">Unable to load tasks. Please try again.</p>}
        {/* CB, Sept 2026: "I shouldn't see that prompted message like there's no task cause...
            it's optional... they should be able to do it whenever" — tasks are a fully optional
            add-on now (see this panel's own doc comment above), so an empty list needs no
            message at all; the "+ Create task" affordance below already reads as available on
            its own. */}
        {(tasksOverride ?? (loadState === "ready" ? tasks : [])).map((t) => (
          <DateTaskRow
            key={t.id}
            task={t}
            viewerId={viewerId}
            canReview
            onChanged={tasksOverride ? onTasksChanged ?? load : load}
            onExpandRequested={onExpandTask ? () => onExpandTask(t) : undefined}
          />
        ))}
      </div>

      {showAddForm ? (
        <form onSubmit={addTask} className="mt-2.5 bg-surface border border-border rounded-2xl p-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title…"
            autoFocus
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder="Instructions or details (optional)…"
          />
          {/* Round seventeen (CB, Oct 2026): optional, right under priority — see this file's
              own doc comment on dueDate/dueTime above for why these stay two plain inputs. */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Due date (optional)</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={!dueDate}
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
              />
            </div>
          </div>
          <div className="flex w-full rounded-lg border border-border overflow-hidden text-xs font-semibold" role="radiogroup" aria-label="Priority">
            <button
              type="button"
              role="radio"
              aria-checked={priority === "NORMAL"}
              onClick={() => setPriority("NORMAL")}
              className={`flex-1 px-3.5 py-1.5 transition-colors ${
                priority === "NORMAL" ? "bg-slate-600 text-white" : "bg-black/[0.03] text-muted hover:bg-black/[0.06]"
              }`}
            >
              Normal
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={priority === "URGENT"}
              onClick={() => setPriority("URGENT")}
              className={`flex-1 px-3.5 py-1.5 border-l border-border transition-colors ${
                priority === "URGENT" ? "bg-rose-600 text-white" : "bg-black/[0.03] text-muted hover:bg-black/[0.06]"
              }`}
            >
              Urgent
            </button>
          </div>
          {addError && <p className="text-xs text-accent">{addError}</p>}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs text-muted file:mr-2 file:rounded-md file:border-0 file:bg-black/[0.05] file:px-2.5 file:py-1.5 file:text-xs file:font-medium max-w-[10rem]"
              />
              {file && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="text-xs text-muted hover:text-accent-ink shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setAddError("");
                }}
                disabled={submitting}
                className="text-sm px-2 py-2 text-muted hover:text-accent-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="btn-primary text-sm px-3.5 py-2 disabled:opacity-60"
              >
                {submitting ? "Adding…" : "Add task"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className={`mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold ${
            onColor ? "text-white/90 hover:text-white" : "text-accent-ink hover:opacity-80"
          }`}
        >
          <span
            className={`flex items-center justify-center h-5 w-5 rounded-full text-sm leading-none ${
              onColor ? "bg-white/25 text-white" : "bg-black/[0.06]"
            }`}
          >
            +
          </span>
          Create a task
        </button>
      )}
    </div>
  );
}
