"use client";

import { useState } from "react";
import type { DateTaskDTO } from "@/types";
import DateTaskRow from "@/components/DateTaskRow";

// Same tone/label pairing DateTaskRow keeps for its own full card (STATUS_LABEL/STATUS_INK in
// that file) — kept as its own small local copy here rather than exported and shared, same
// "local copy for a couple of lines" convention this app already uses for things like initialsOf.
const STATUS_LABEL: Record<DateTaskDTO["status"], string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  AWAITING_REVIEW: "Awaiting review",
  APPROVED: "Approved",
  RETURNED: "Returned",
};

const STATUS_DOT: Record<DateTaskDTO["status"], string> = {
  ASSIGNED: "#b45309",
  IN_PROGRESS: "#b45309",
  AWAITING_REVIEW: "#047857",
  APPROVED: "var(--ttc-pink-ink)",
  RETURNED: "#be123c",
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Strips whatever HTML RichTextEditor could have produced down to plain text for this list's
 *  own short preview line only — never rendered as HTML (no dangerouslySetInnerHTML here), so
 *  there's nothing to sanitize. The real, safe render of the full description happens inside
 *  DateTaskRow itself once a task is actually opened, same as it always has. */
function plainTextPreview(description: string): string {
  return description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Round seventeen (CB, Oct 2026, on the Team Tasks page, circling the blank space beside a task
 * card: "if we had the option to expand it... for desktop specifically, if we expand it, it'll
 * kind of be like this... so that we could read it legibly" — approved against a clickable
 * mockup she tried herself before this was built for real).
 *
 * At desktop widths this splits one employee's task list into a short column of summaries plus a
 * wider panel that opens the tapped task's own full card at closer to the page's actual
 * available width, instead of it staying squeezed into TeamTasksView's own max-w-3xl column with
 * all that space sitting empty beside it. Below desktop width (`lg`) nothing changes at all —
 * the exact same single stacked column of full DateTaskRow cards this page has always shown, no
 * selection step added, since CB asked for this "for desktop specifically."
 *
 * Deliberately reuses DateTaskRow itself for the open task rather than rebuilding its actions,
 * comments, and attachments a second time in a slimmer "detail panel" component — this is a
 * wider column, not a different component, so every existing interaction (Approve, Send back,
 * Mark complete, commenting) keeps working completely unchanged.
 */
export default function TeamTaskList({
  tasks,
  viewerId,
  onChanged,
}: {
  tasks: DateTaskDTO[];
  viewerId: string;
  onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <>
      {/* Below desktop width: unchanged from before this feature — every task as its own full
          card, stacked, same as this page has always shown. */}
      <div className="space-y-2.5 lg:hidden">
        {tasks.map((t) => (
          <DateTaskRow key={t.id} task={t} viewerId={viewerId} canReview showDate onChanged={onChanged} />
        ))}
      </div>

      {/* Desktop width: a short list of summaries on the left, the tapped task's own full card
          on the right — see this component's own doc comment above. */}
      <div className="hidden lg:grid lg:grid-cols-[19rem_1fr] lg:items-start lg:gap-4">
        <div className="space-y-2">
          {tasks.map((t) => {
            const isSelected = t.id === selectedId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(isSelected ? null : t.id)}
                aria-pressed={isSelected}
                className={`w-full text-left rounded-xl border px-3.5 py-3 transition-colors ${
                  isSelected ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-black/[0.02]"
                }`}
              >
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT[t.status] }} />
                  <span className="text-[11px] font-semibold text-muted">{STATUS_LABEL[t.status]}</span>
                  {t.priority === "URGENT" && <span className="text-[11px] font-semibold text-rose-700">· Urgent</span>}
                </div>
                <p className={`text-sm font-semibold truncate ${isSelected ? "text-accent-ink" : "text-foreground"}`}>
                  {t.title}
                </p>
                {t.description && (
                  <p className="text-xs text-muted mt-0.5 line-clamp-2">{plainTextPreview(t.description)}</p>
                )}
                <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-muted">
                  <span>Assigned {shortDate(t.createdAt)}</span>
                  {t.dueAt && <span>Due {shortDate(t.dueAt)}</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:sticky lg:top-4">
          {selected ? (
            <DateTaskRow task={selected} viewerId={viewerId} canReview showDate onChanged={onChanged} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center text-sm text-muted">
              Select a task to read it here, at the full width.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
