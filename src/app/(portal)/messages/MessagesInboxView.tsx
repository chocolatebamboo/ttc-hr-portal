"use client";

import { useState } from "react";
import TeamNotesThread from "@/components/TeamNotesThread";
import DirectMessageThread from "@/components/DirectMessageThread";
import NewMessagePicker from "@/components/NewMessagePicker";
import SwipeReveal from "@/components/SwipeReveal";
import { ChatIcon, CheckCircleIcon, UserCircleIcon } from "@/components/icons";
import type { DirectConversationSummaryDTO, DirectoryEntryDTO, TeamNoteTopicCountDTO } from "@/types";

/** "Fri, Oct 9" — same short date shape used for availability date chips elsewhere. */
function formatTopicDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function topicLabel(c: TeamNoteTopicCountDTO): string {
  return c.topicType === "AVAILABILITY_DATE" && c.topicDate ? formatTopicDate(c.topicDate) : "Time off request";
}

function topicRowKey(c: TeamNoteTopicCountDTO): string {
  return `topic:${c.employeeId}:${c.topicType}:${c.topicId}:${c.topicDate ?? ""}`;
}

function dmRowKey(employeeId: string): string {
  return `dm:${employeeId}`;
}

/** The badged conversation kinds — both carry total/fromOthers, so they can share one sort
 *  without TypeScript needing to prove the general row (which has neither) never sneaks in. */
type CountedRow =
  | { kind: "topic"; key: string; name: string; subtitle: string; total: number; fromOthers: number; c: TeamNoteTopicCountDTO }
  | { kind: "dm"; key: string; name: string; total: number; fromOthers: number; employeeId: string };

/** The three kinds of conversation this inbox lists, folded into one shape so they can share a
 *  single row layout — CB, Sept 2026: "so its no longer notes its 'My Messages,'" one place for
 *  every conversation instead of hunting across separate pages. */
type Row = { kind: "general"; key: string; name: string } | CountedRow;

/**
 * CB, Sept 2026: "I send it to Sean, I don't see where Sean could see those messages... it
 * needs to kinda read cleanly" (round four/five) — every conversation, in one scannable list.
 * Extended this round: "instead of notes, I want it to be messages... look up members and send
 * them individual messages... have an internal conversation there," so this now also carries
 * the general HR/supervisor thread (previously its own /notes page) and real peer-to-peer DMs
 * alongside the per-date/PTO topic conversations this page already had. Conversations with
 * unread-from-others activity sort first; within that, busier conversations first — the general
 * thread has no count of its own (nothing tracked "unread" for it before this round) so it
 * always sorts last, as a quiet, always-available fallback rather than competing for attention.
 *
 * Tapping a row expands the matching thread component inline — TeamNotesThread for the general
 * and topic rows (same component the admin card views and Availability/My Time pages already
 * use, so a message sent from any of those surfaces still lands here), DirectMessageThread for
 * DMs. "New message" opens NewMessagePicker to look up a teammate and start (or reopen) a DM.
 */
export default function MessagesInboxView({
  viewerId,
  viewerName,
  topicCounts,
  directConversations,
}: {
  viewerId: string;
  viewerName: string;
  topicCounts: TeamNoteTopicCountDTO[];
  directConversations: DirectConversationSummaryDTO[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  // Conversations picked via "New message" but with no messages sent yet — not part of
  // directConversations (which only ever reflects rows that actually exist in the database)
  // until the first message is sent, at which point the real fetch below takes over.
  const [pendingDms, setPendingDms] = useState<Map<string, string>>(new Map());

  const dmRows: CountedRow[] = [...new Map([...pendingDms].map(([id, name]) => [id, name])).entries()]
    .filter(([id]) => !directConversations.some((c) => c.employeeId === id))
    .map(([id, name]) => ({ kind: "dm" as const, key: dmRowKey(id), name, total: 0, fromOthers: 0, employeeId: id }))
    .concat(
      directConversations.map((c) => ({
        kind: "dm" as const,
        key: dmRowKey(c.employeeId),
        name: c.employeeName,
        total: c.total,
        fromOthers: c.fromOthers,
        employeeId: c.employeeId,
      }))
    );

  const rows: CountedRow[] = [
    ...topicCounts.map((c) => ({
      kind: "topic" as const,
      key: topicRowKey(c),
      name: c.employeeName,
      subtitle: topicLabel(c),
      total: c.total,
      fromOthers: c.fromOthers,
      c,
    })),
    ...dmRows,
  ]
    .filter((r) => !dismissed.has(r.key))
    .sort((a, b) => {
      if (a.fromOthers !== b.fromOthers) return b.fromOthers - a.fromOthers;
      return b.total - a.total;
    });

  const generalRow: Row = { kind: "general", key: "general", name: "HR & Your Supervisor" };

  function handlePick(entry: DirectoryEntryDTO) {
    setPickerOpen(false);
    setPendingDms((prev) => new Map(prev).set(entry.id, entry.name));
    setOpenKey(dmRowKey(entry.id));
  }

  function renderRow(row: Row) {
    const open = openKey === row.key;
    return (
      <SwipeReveal
        key={row.key}
        actionSide="left"
        actionLabel="Clear"
        actionIcon={<CheckCircleIcon className="h-4 w-4" />}
        actionClassName="bg-black/[0.06] text-accent-ink"
        onAction={() => setDismissed((prev) => new Set(prev).add(row.key))}
      >
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setOpenKey(open ? null : row.key)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] transition-colors"
          >
            <div className="min-w-0 flex items-center gap-3">
              <UserCircleIcon className="h-8 w-8 text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{row.name}</p>
                <p className="text-xs text-muted truncate">
                  {row.kind === "general" ? "Your general thread" : row.kind === "topic" ? row.subtitle : "Direct message"}
                </p>
              </div>
            </div>
            {row.kind !== "general" && (
              <div className="flex items-center gap-2 shrink-0">
                {row.fromOthers > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-accent/10 text-accent-ink text-xs font-semibold px-2 py-0.5">
                    <ChatIcon className="h-3 w-3" />
                    {row.fromOthers}
                  </span>
                )}
                <span className="text-xs text-muted">
                  {row.total} message{row.total === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </button>
          {open && (
            <div className="border-t border-border p-3">
              {row.kind === "general" && <TeamNotesThread employeeId={viewerId} viewerId={viewerId} />}
              {row.kind === "topic" && (
                <TeamNotesThread
                  employeeId={row.c.employeeId}
                  viewerId={viewerId}
                  topicType={row.c.topicType}
                  topicId={row.c.topicId}
                  topicDate={row.c.topicDate ?? undefined}
                />
              )}
              {row.kind === "dm" && <DirectMessageThread otherEmployeeId={row.employeeId} viewerId={viewerId} />}
            </div>
          )}
        </div>
      </SwipeReveal>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="page-title text-2xl">My Messages</h1>
        <button type="button" onClick={() => setPickerOpen(true)} className="btn-primary text-sm px-3.5 py-2 flex items-center gap-1.5 shrink-0">
          <span className="text-base leading-none">+</span>
          New message
        </button>
      </div>
      <p className="text-sm text-muted mb-4">
        Hi {viewerName} — every conversation in one place: your general thread, messages about a specific date or
        request, and direct messages with teammates.
      </p>

      <div className="space-y-2.5">
        {renderRow(generalRow)}
        {rows.map(renderRow)}
      </div>

      {pickerOpen && <NewMessagePicker viewerId={viewerId} onPick={handlePick} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
