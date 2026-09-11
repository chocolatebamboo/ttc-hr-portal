"use client";

import { useState } from "react";
import TeamNotesThread from "@/components/TeamNotesThread";
import SwipeReveal from "@/components/SwipeReveal";
import { ChatIcon, CheckCircleIcon } from "@/components/icons";
import type { TeamNoteTopicCountDTO } from "@/types";

/** "Fri, Oct 9" — same short date shape used for availability date chips elsewhere. */
function formatTopicDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function topicLabel(c: TeamNoteTopicCountDTO): string {
  return c.topicType === "AVAILABILITY_DATE" && c.topicDate ? formatTopicDate(c.topicDate) : "Time off request";
}

function topicKey(c: TeamNoteTopicCountDTO): string {
  return `${c.employeeId}:${c.topicType}:${c.topicId}:${c.topicDate ?? ""}`;
}

/**
 * CB, Sept 2026: "I send it to Sean, I don't see where Sean could see those messages... it
 * needs to kinda read cleanly" — every per-date/per-request conversation, admin-wide or (for
 * anyone else) just the viewer's own, in one scannable list instead of hunting through cards
 * one by one. Conversations with unread-from-others activity (fromOthers > 0) sort first;
 * within that, busier conversations first. Tapping a row expands the exact same
 * TeamNotesThread the admin card views and the employee's own Availability/My Time pages use,
 * so a message sent from any of those surfaces lands in the same place here.
 *
 * CB, round four: "I love that [message feature], but I should be able to clear it by...
 * swiping to the right." This clears a conversation from THIS list only, for this viewer, in
 * this browser — it's a client-side dismissal, not a real "mark read/archived" record on the
 * server. Nothing is deleted: the underlying conversation and its messages are untouched, and
 * a genuinely new message reopens/re-surfaces it next load since `counts` comes fresh from the
 * server each time. A real per-viewer dismissal (persisted, synced across devices) would need
 * its own schema/table — flagged to CB as a possible follow-up rather than folded into this
 * batch.
 */
export default function MessagesInboxView({ viewerId, counts }: { viewerId: string; counts: TeamNoteTopicCountDTO[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const sorted = [...counts]
    .filter((c) => !dismissed.has(topicKey(c)))
    .sort((a, b) => {
      if (a.fromOthers !== b.fromOthers) return b.fromOthers - a.fromOthers;
      return b.total - a.total;
    });

  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">Messages</h1>
      <p className="text-sm text-muted mb-4">
        Every conversation about a specific date or time-off request, in one place.
      </p>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No conversations yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((c) => {
            const key = topicKey(c);
            const open = openKey === key;
            return (
              <SwipeReveal
                key={key}
                actionSide="left"
                actionLabel="Clear"
                actionIcon={<CheckCircleIcon className="h-4 w-4" />}
                actionClassName="bg-black/[0.06] text-accent-ink"
                onAction={() => setDismissed((prev) => new Set(prev).add(key))}
              >
                <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenKey(open ? null : key)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.employeeName}</p>
                      <p className="text-xs text-muted truncate">{topicLabel(c)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.fromOthers > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-accent/10 text-accent-ink text-xs font-semibold px-2 py-0.5">
                          <ChatIcon className="h-3 w-3" />
                          {c.fromOthers}
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        {c.total} message{c.total === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                  {open && (
                    <div className="border-t border-border p-3">
                      <TeamNotesThread
                        employeeId={c.employeeId}
                        viewerId={viewerId}
                        topicType={c.topicType}
                        topicId={c.topicId}
                        topicDate={c.topicDate ?? undefined}
                      />
                    </div>
                  )}
                </div>
              </SwipeReveal>
            );
          })}
        </div>
      )}
    </div>
  );
}
