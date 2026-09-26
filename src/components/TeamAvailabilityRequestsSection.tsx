"use client";

import { useState } from "react";
import Link from "next/link";
import SwipeReveal from "@/components/SwipeReveal";
import { ChevronDownIcon, TrashIcon } from "@/components/icons";
import { formatSlotDate } from "@/lib/availability-format";
import { toneForStatus, YOU_TONE } from "@/lib/status-tone";
import { useTeamAvailabilityQueue, initialsOf, groupByEmployee, Card } from "@/components/TeamAvailabilityCards";
import type { AdminAvailabilityDTO, AvailabilitySlot } from "@/types";

function summarizeSlots(slots: AvailabilitySlot[]): string {
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
  const first = formatSlotDate(sorted[0].date);
  return sorted.length === 1 ? first : `${first} +${sorted.length - 1} more`;
}

const MAX_SHOWN = 5;

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
  const shown = groupByEmployee(q.pending).slice(0, MAX_SHOWN);

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
        {shown.map((group) => {
          const isSelf = group.employeeId === viewerId;
          const tone = isSelf ? YOU_TONE : toneForStatus(group.submissions[0].status);
          const expanded = expandedId === group.employeeId;
          const solo = group.submissions.length === 1 ? group.submissions[0] : null;
          const totalDates = group.submissions.reduce((sum, s) => sum + s.slots.length, 0);

          if (!expanded) {
            return (
              <button
                key={group.employeeId}
                type="button"
                onClick={() => setExpandedId(group.employeeId)}
                className="w-full flex items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left shadow-sm transition-transform active:scale-[0.99]"
                style={{ background: `linear-gradient(150deg, ${tone.from} 0%, ${tone.to} 100%)` }}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="h-8 w-8 rounded-full bg-white/25 border border-white/40 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                    {initialsOf(group.employeeName)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{group.employeeName}</p>
                    <p className="text-xs text-white/80 truncate">
                      {solo ? summarizeSlots(solo.slots) : `${totalDates} dates · ${group.submissions.length} requests`}
                    </p>
                  </div>
                </div>
                <ChevronDownIcon className="h-4 w-4 text-white/80 shrink-0" />
              </button>
            );
          }

          const card = (
            <Card
              submissions={group.submissions}
              viewerId={viewerId}
              busy={group.submissions.some((s) => s.id === q.busyId)}
              addingNote={solo !== null && q.addingNoteId === solo.id}
              noteText={q.noteText}
              decideError={group.submissions.some((s) => s.id === q.decideErrorId) ? q.decideError : undefined}
              removing={solo !== null && q.removingId === solo.id}
              removeError={group.submissions.some((s) => s.id === q.removeErrorId) ? q.removeError : undefined}
              openDate={q.openDate}
              shiftsByDate={q.shiftsByDate}
              dmCounts={q.dmCounts}
              onToggleDate={(submissionId, date) =>
                q.setOpenDate(q.openDate?.submissionId === submissionId && q.openDate.date === date ? null : { submissionId, date })
              }
              onAddNoteToggle={() => solo && q.setAddingNoteId(q.addingNoteId === solo.id ? null : solo.id)}
              onNoteTextChange={q.setNoteText}
              onAddNote={q.addNote}
              onAddDateNote={q.addDateNote}
              onDecide={q.decide}
              onDecideDate={q.decideDate}
              onUndo={q.undo}
              onUndoDate={q.undoDate}
              onChangeDate={q.changeDate}
              onRemoveConfirm={q.removeSubmission}
              onRemoveCancel={q.cancelRemove}
              onOpenChat={q.openChat}
              onMessageAboutDate={q.openChatForDate}
              onRemoveDate={q.removeDate}
            />
          );

          return (
            <div key={group.employeeId}>
              <button
                type="button"
                onClick={() => setExpandedId(null)}
                className="w-full flex items-center justify-between gap-2 px-1 pb-1.5 text-xs font-medium text-muted hover:text-foreground"
              >
                <span className="truncate">{group.employeeName} — tap to collapse</span>
                <ChevronDownIcon className="h-3.5 w-3.5 rotate-180 shrink-0" />
              </button>
              {solo ? (
                <SwipeReveal
                  actionSide="right"
                  actionLabel="Remove"
                  actionIcon={<TrashIcon className="h-4 w-4" />}
                  actionClassName="bg-rose-600 text-white rounded-3xl"
                  onAction={() => q.setRemovingId(solo.id)}
                >
                  {card}
                </SwipeReveal>
              ) : (
                card
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
