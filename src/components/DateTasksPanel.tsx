"use client";

import { useEffect, useRef, useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";

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
}: {
  employeeId: string;
  taskDate: string;
  /** The signed-in admin/supervisor viewing this panel — passed straight through to DateTaskRow
   *  so its comment thread knows which side of a bubble is "you." */
  viewerId: string;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, taskDate]);

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
      if (fileInputRef.current) fileInputRef.current.value = "";
      setShowAddForm(false);
      await load();
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
        {loadState === "loading" && <div className="h-16 rounded-2xl bg-black/[0.04] animate-pulse" />}
        {loadState === "error" && <p className="text-sm text-accent">Unable to load tasks. Please try again.</p>}
        {loadState === "ready" && tasks.length === 0 && (
          <p className="text-sm text-muted">No tasks pushed for this date yet.</p>
        )}
        {loadState === "ready" &&
          tasks.map((t) => (
            <DateTaskRow key={t.id} task={t} viewerId={viewerId} canReview onChanged={load} />
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
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Instructions or details (optional)…"
            rows={2}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent resize-none"
          />
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
          className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink hover:opacity-80"
        >
          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-black/[0.06] text-sm leading-none">+</span>
          Create task
        </button>
      )}
    </div>
  );
}
