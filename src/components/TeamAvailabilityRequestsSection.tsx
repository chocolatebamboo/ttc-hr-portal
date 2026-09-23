"use client";

import { useState } from "react";
import Link from "next/link";
import SwipeReveal from "@/components/SwipeReveal";
import { ChevronDownIcon, TrashIcon } from "@/components/icons";
import { formatSlotDate } from "@/lib/availability-format";
import { toneForStatus, YOU_TONE } from "@/lib/status-tone";
import { useTeamAvailabilityQueue, initialsOf, Card } from "@/components/TeamAvailabilityCards";
import type { AdminAvailabilityDTO, AvailabilitySlot } from "@/types";

/** Same one-line "Thu, Sep 17 +2 more" shape as AvailabilityStatusSection's own summarizeSlots —
 *  duplicated rather than imported since that one lives in the employee-facing file and this is
 *  the admin-facing counterpart; nothing here needs slot times, just enough to place each
 *  request at a glance next to whose it is. */
function summarizeSlots(slots: AvailabilitySlot[]): string {
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
  const first = formatSlotDate(sorted[0].date);
  return sorted.length === 1 ? first : `${first} +${sorted.length - 1} more`;
}

// A Home page sidebar widget stays a glance, not a queue — past this many rows the header's own
// "Review →" link (into the full Team availability requests list on /availability) is the way
// to see the rest, same "cap here, full list lives on its own page" split AnnouncementsSection
// uses via dashboard/page.tsx's own .slice(0, 3) for announcements.
const MAX_SHOWN = 5;

/**
 * CB, Sept 2026: "I want that to be where the announcements are... for the admin, that would be
 * covering, you know, schedules and stuff like that." An admin-only counterpart to
 * AnnouncementsSection/NeedsAttentionSection, in that same Home page sidebar spot — CB
 * specifically wants her team's pending availability requests visible the moment she opens the
 * app, not just reachable by remembering to check the Availability tab.
 *
 * Redesign follow-up (Sept 2026), CB: "it's not color coded like it was in the availability...
 * it could be small, but then it should be able to expand so we could see and approve from the
 * homepage as well. Basically the same experience that you would have done in the... availability
 * tab." This is no longer a plain read-only list — each row now carries the same orange/pink
 * gradient tone the full /availability admin page uses (toneForStatus/YOU_TONE), and tapping a
 * row expands it in place into the exact same `Card` component TeamAvailabilityCards renders on
 * that full page, driven by the same `useTeamAvailabilityQueue` hook — so approving, denying,
 * per-date decisions, the chat bubble, everything, works identically from here. Only one row is
 * ever expanded at a time (an accordion), matching the "This week" strip's own single-open-panel
 * feel on the Availability page.
 *
 * `initialPending` seeds the hook from what dashboard/page.tsx already fetched server-side for
 * this admin's first paint, so this widget shows real rows immediately rather than a loading
 * skeleton flash while the hook's own client-side refresh catches up in the background — see
 * useTeamAvailabilityQueue's own doc comment. Once a row is decided (approved/denied) from here,
 * the hook's decide()/decideDate() reload the server's pending/decided lists and the row simply
 * drops out of q.pending, same as it would on the full page.
 *
 * Renamed from "Availability requests" to "Team availability requests" everywhere it appears
 * (here and the heading above TeamAvailabilityCards on /availability) — CB: pairs with the
 * "Time off requests" heading right below it on that same page, and reads unambiguously as HER
 * team's requests to review, not her own.
 *
 * Hidden entirely when there's nothing pending, same as Needs your attention, rather than an
 * always-there "nothing pending" placeholder — this is meant to disappear the moment the queue's
 * clear, not sit there as permanent chrome the way Announcements (which always has *something* to
 * show, even if it's just "No announcements right now") does.
 */
export default function TeamAvailabilityRequestsSection({
  className,
  initialPending,
  viewerId,
}: {
  className?: string;
  initialPending: AdminAvailabilityDTO[];
  viewerId: string;
}) {
  const q = useTeamAvailabilityQueue({ initialPending });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (q.pending.length === 0) return null;
  const shown = q.pending.slice(0, MAX_SHOWN);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-muted">
          Team availability requests <span className="font-normal">({q.pending.length})</span>
        </h2>
        <Link href="/availability" className="text-xs font-medium text-accent-ink hover:underline">
          Review →
        </Link>
      </div>
      <div className="space-y-2">
        {shown.map((r) => {
          const isSelf = r.employeeId === viewerId;
          const tone = isSelf ? YOU_TONE : toneForStatus(r.status);
          const expanded = expandedId === r.id;

          if (!expanded) {
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setExpandedId(r.id)}
                className="w-full flex items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left shadow-sm transition-transform active:scale-[0.99]"
                style={{ background: `linear-gradient(150deg, ${tone.from} 0%, ${tone.to} 100%)` }}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="h-8 w-8 rounded-full bg-white/25 border border-white/40 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                    {initialsOf(r.employeeName)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{r.employeeName}</p>
                    <p className="text-xs text-white/80 truncate">{summarizeSlots(r.slots)}</p>
                  </div>
                </div>
                <ChevronDownIcon className="h-4 w-4 text-white/80 shrink-0" />
              </button>
            );
          }

          return (
            <div key={r.id}>
              <button
                type="button"
                onClick={() => setExpandedId(null)}
                className="w-full flex items-center justify-between gap-2 px-1 pb-1.5 text-xs font-medium text-muted hover:text-foreground"
              >
                <span className="truncate">{r.employeeName} — tap to collapse</span>
                <ChevronDownIcon className="h-3.5 w-3.5 rotate-180 shrink-0" />
              </button>
              <SwipeReveal
                actionSide="right"
                actionLabel="Remove"
                actionIcon={<TrashIcon className="h-4 w-4" />}
                actionClassName="bg-rose-600 text-white rounded-3xl"
                onAction={() => q.setRemovingId(r.id)}
              >
                <Card
                  row={r}
                  viewerId={viewerId}
                  busy={q.busyId === r.id}
                  denying={q.denyingId === r.id}
                  denyComment={q.denyComment}
                  decideError={q.decideErrorId === r.id ? q.decideError : undefined}
                  removing={q.removingId === r.id}
                  removeError={q.removeErrorId === r.id ? q.removeError : undefined}
                  openDate={q.openDate?.submissionId === r.id ? q.openDate.date : null}
                  shiftsByDate={q.shiftsByDate}
                  dmCounts={q.dmCounts}
                  onToggleDate={(date) =>
                    q.setOpenDate(q.openDate?.submissionId === r.id && q.openDate.date === date ? null : { submissionId: r.id, date })
                  }
                  onDenyToggle={() => q.setDenyingId(q.denyingId === r.id ? null : r.id)}
                  onDenyCommentChange={q.setDenyComment}
                  onDecide={q.decide}
                  onDecideDate={q.decideDate}
                  onUndo={q.undo}
                  onUndoDate={q.undoDate}
                  onRequestAdjustment={q.requestAdjustment}
                  onRemoveConfirm={q.removeSubmission}
                  onRemoveCancel={q.cancelRemove}
                  onOpenChat={q.openChat}
                  onMessageAboutDate={q.openChatForDate}
                  onRemoveDate={q.removeDate}
                />
              </SwipeReveal>
            </div>
          );
        })}
      </div>
    </div>
  );
}
