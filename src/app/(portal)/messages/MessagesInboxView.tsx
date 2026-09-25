"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

/** Same two-letter avatar initials shape used across the app's other card/row lists
 *  (TeamAvailabilityCards' own initialsOf, TeamPtoCards, etc.) — kept as a small local copy
 *  since this file has no reason to import a feature-specific helper otherwise. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/** The badged conversation kinds — both carry total/unread, so they can share one sort without
 *  TypeScript needing to prove the general row (which has neither) never sneaks in. Sorts and
 *  badges on `unread` (Correction brief #1: "genuinely unread messages"), not the older
 *  `fromOthers` — see TeamNoteTopicCountDTO's own comment in src/types/index.ts for the
 *  difference. */
type CountedRow =
  | { kind: "topic"; key: string; name: string; subtitle: string; total: number; unread: number; c: TeamNoteTopicCountDTO }
  | { kind: "dm"; key: string; name: string; total: number; unread: number; employeeId: string };

/** The three kinds of conversation this inbox lists, folded into one shape so they can share a
 *  single row layout — CB, Sept 2026: "so its no longer notes its 'My Messages,'" one place for
 *  every conversation instead of hunting across separate pages. */
type Row = { kind: "general"; key: string; name: string } | CountedRow;

/** The employeeId a row's own conversation is with — undefined for the general thread, which
 *  isn't with any one team member. Used to look up that person's jobTitle/department/email from
 *  the directory (see `directoryById` below) for both the list row's subtitle and the desktop
 *  pane header. */
function rowEmployeeId(row: Row): string | undefined {
  if (row.kind === "topic") return row.c.employeeId;
  if (row.kind === "dm") return row.employeeId;
  return undefined;
}

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
 * On mobile, tapping a row still expands the matching thread component inline exactly as it
 * always has — TeamNotesThread for the general and topic rows (same component the admin card
 * views and Availability/My Time pages already use, so a message sent from any of those surfaces
 * still lands here), DirectMessageThread for DMs. "New message" opens NewMessagePicker to look
 * up a teammate and start (or reopen) a DM.
 *
 * Desktop redesign (CB, Sept 2026, approved mockup): "I like being able to see the conversation
 * list and the full selected conversation at the same time. Each person's name, title, and
 * basic information should also be visible." At `md` and wider this instead renders a two-pane
 * layout — the same row list as a fixed-width left column, and whichever conversation is
 * selected open at full height in a right-hand pane, both thread components rendered via their
 * new `fill` prop (see TeamNotesThread/DirectMessageThread's own doc comments) instead of their
 * usual capped-height card chrome. `isDesktop` is tracked in JS (matchMedia) rather than via
 * Tailwind `md:` classes so only ONE layout tree — and ONE mounted thread component — ever
 * exists at a time; two CSS-hidden copies would each run their own fetch/mount. It starts false
 * so the server-rendered HTML and the client's first render match exactly (avoiding a hydration
 * mismatch), then flips right after mount on a desktop-width screen — a one-time, sub-beat
 * layout flash on desktop load, accepted as the standard cost of that pattern. `directoryById`
 * (loaded client-side, same /api/directory list DirectMessageThread and NewMessagePicker already
 * use) backs the job-title/department/email each list row and the pane header show for a topic
 * or DM row's person — the general thread has no such row.
 */
export default function MessagesInboxView({
  viewerId,
  viewerName,
  topicCounts,
  directConversations,
  canUseInternalNotes,
}: {
  viewerId: string;
  viewerName: string;
  topicCounts: TeamNoteTopicCountDTO[];
  directConversations: DirectConversationSummaryDTO[];
  /** Phase 5c (CB, Sept 2026): "an option to add an internal comment," confirmed scope "hidden
   *  from the team member." Passed straight through to every DirectMessageThread below; see
   *  that prop's own doc comment there for what it actually gates. */
  canUseInternalNotes: boolean;
}) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Correction brief #9 (Sept 2026): "persist dismissal state" is required for "dismissible
  // notifications and availability records" specifically — an inbox row here is neither (it's a
  // conversation, not a Notification-model record or an AvailabilitySubmission), so this stays
  // the same client-side-only clear it always was: reloading brings a dismissed row back. Only
  // the swipe DIRECTION changed this round, to match the brief's "swipe left → reveal actions on
  // the right" everywhere else (DashboardNotifications.tsx, TeamAvailabilityCards.tsx). Mobile
  // only — see the desktop row renderer's own comment for why the two-pane list drops the swipe
  // gesture rather than carrying it over.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  // Conversations picked via "New message" but with no messages sent yet — not part of
  // directConversations (which only ever reflects rows that actually exist in the database)
  // until the first message is sent, at which point the real fetch below takes over.
  const [pendingDms, setPendingDms] = useState<Map<string, string>>(new Map());
  // Phase 5d (CB, Sept 2026): "chat icons on availability requests linked to specific dates" —
  // the reference a date-chat link asks the thread below to pre-attach, read from the URL
  // alongside dm/name (see the effect below). Only ever meant for the ONE thread that's about
  // to open as a result of this exact link — cleared the moment DirectMessageThread has
  // captured it (its own onInitialRefConsumed callback), so reopening a thread later (or a
  // different one) never inherits a stale reference from an earlier date-chat click.
  const [pendingRef, setPendingRef] = useState<{ type: "AVAILABILITY_DATE"; id: string; date: string } | null>(null);
  // Desktop redesign — see this component's own doc comment above for why this is tracked in JS
  // rather than via Tailwind `md:` classes, and why it starts false.
  const [isDesktop, setIsDesktop] = useState(false);
  // Desktop redesign — the org directory, loaded once, backing the job-title/department/email
  // shown next to a topic or DM row's person (both in the list and the open pane's header). Same
  // /api/directory list DirectMessageThread's own @mention feature and NewMessagePicker already
  // use. Best-effort: a failed load just means those rows fall back to their plain "Direct
  // message"/topic-only subtitle, never a broken inbox.
  const [directory, setDirectory] = useState<DirectoryEntryDTO[]>([]);

  // Correction brief #11 (Sept 2026): "The chat bubble on an availability request should take
  // the user into My Messages... open the relevant conversation/thread for that specific team
  // member." TeamAvailabilityCards.tsx's chat button links here as
  // /messages?dm=<employeeId>&name=<employeeName> — read straight off window.location (not
  // next/navigation's useSearchParams) so this page doesn't need a Suspense boundary, same
  // reasoning src/app/login/page.tsx's own OAuth-error handling already documents. Reuses the
  // exact "pending DM, not yet a real conversation" path handlePick below already established,
  // so a chat started from an availability card behaves identically to one started from "New
  // message." The URL is cleaned up immediately after, so refreshing or sharing this page's link
  // doesn't keep re-opening the same conversation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dm = params.get("dm");
    if (dm) {
      const name = params.get("name") || "Team member";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingDms((prev) => new Map(prev).set(dm, name));
      // Phase 5d: the same link can also carry refType/refId/refDate — see TeamAvailabilityCards'
      // openChatForDate, which is the only place that adds them today. All three or none; a
      // partial/malformed set is just ignored rather than opening the thread with a broken ref.
      const refType = params.get("refType");
      const refId = params.get("refId");
      const refDate = params.get("refDate");
      if (refType === "AVAILABILITY_DATE" && refId && refDate) {
        setPendingRef({ type: "AVAILABILITY_DATE", id: refId, date: refDate });
      }
      setOpenKey(dmRowKey(dm));
      window.history.replaceState(null, "", "/messages");
    }
  }, []);

  // Desktop redesign — see this component's own doc comment above.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Desktop redesign — best-effort directory load, see this component's own doc comment above.
  useEffect(() => {
    async function loadDirectory() {
      try {
        const res = await fetch("/api/directory");
        if (!res.ok) return;
        const data: { directory: DirectoryEntryDTO[] } = await res.json();
        setDirectory(data.directory);
      } catch {
        // ignored — see comment above
      }
    }
    loadDirectory();
  }, []);

  const directoryById = useMemo(() => new Map(directory.map((e) => [e.id, e])), [directory]);

  const dmRows: CountedRow[] = [...new Map([...pendingDms].map(([id, name]) => [id, name])).entries()]
    .filter(([id]) => !directConversations.some((c) => c.employeeId === id))
    .map(([id, name]) => ({ kind: "dm" as const, key: dmRowKey(id), name, total: 0, unread: 0, employeeId: id }))
    .concat(
      directConversations.map((c) => ({
        kind: "dm" as const,
        key: dmRowKey(c.employeeId),
        name: c.employeeName,
        total: c.total,
        unread: c.unread,
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
      unread: c.unread,
      c,
    })),
    ...dmRows,
  ]
    .filter((r) => !dismissed.has(r.key))
    .sort((a, b) => {
      if (a.unread !== b.unread) return b.unread - a.unread;
      return b.total - a.total;
    });

  const generalRow: Row = { kind: "general", key: "general", name: "HR & Your Supervisor" };

  // Desktop redesign — which row's conversation is open in the right pane. Falls back to the
  // busiest/most-recent real conversation (mirroring `rows`' own sort), and only to the general
  // thread once there are none — the quiet fallback thread isn't a useful default when there's
  // an actual conversation waiting. Mobile is unaffected: it keeps using `openKey` directly
  // (null means nothing expanded), never this fallback.
  const desktopSelectedKey = openKey ?? rows[0]?.key ?? generalRow.key;
  const selectedRow: Row = [generalRow, ...rows].find((r) => r.key === desktopSelectedKey) ?? generalRow;

  function handlePick(entry: DirectoryEntryDTO) {
    setPickerOpen(false);
    setPendingDms((prev) => new Map(prev).set(entry.id, entry.name));
    setOpenKey(dmRowKey(entry.id));
  }

  /** Mobile row — unchanged from before the desktop redesign: a swipe-to-clear card that expands
   *  the matching thread inline, directly beneath itself, when tapped. */
  function renderRow(row: Row) {
    const open = openKey === row.key;
    return (
      <SwipeReveal
        key={row.key}
        actionSide="right"
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
                {row.unread > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-accent/10 text-accent-ink text-xs font-semibold px-2 py-0.5">
                    <ChatIcon className="h-3 w-3" />
                    {row.unread}
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
              {row.kind === "general" && (
                <TeamNotesThread employeeId={viewerId} viewerId={viewerId} onRead={() => router.refresh()} />
              )}
              {row.kind === "topic" && (
                <TeamNotesThread
                  employeeId={row.c.employeeId}
                  viewerId={viewerId}
                  topicType={row.c.topicType}
                  topicId={row.c.topicId}
                  topicDate={row.c.topicDate ?? undefined}
                  onRead={() => router.refresh()}
                />
              )}
              {row.kind === "dm" && (
                <DirectMessageThread
                  otherEmployeeId={row.employeeId}
                  viewerId={viewerId}
                  canUseInternalNotes={canUseInternalNotes}
                  initialRef={pendingRef}
                  onInitialRefConsumed={() => setPendingRef(null)}
                  onRead={() => router.refresh()}
                />
              )}
            </div>
          )}
        </div>
      </SwipeReveal>
    );
  }

  /** Desktop redesign — one row in the left-pane list. A plain selectable button rather than
   *  mobile's swipe-to-clear card: dismissal is a mobile-swipe convention that doesn't translate
   *  to a mouse-driven list the same way, and CB's own ask here was seeing the list and the open
   *  conversation together, not carrying every mobile gesture over — a "Clear" affordance can
   *  still be added here later if it turns out to be missed. Selecting a row just updates
   *  `openKey`; the actual thread renders once, in the pane on the right (renderThreadPane
   *  below), never inline under the row the way it does on mobile. */
  function renderListRow(row: Row) {
    const active = row.key === desktopSelectedKey;
    const entry = row.kind !== "general" ? directoryById.get(rowEmployeeId(row) ?? "") : undefined;
    const subtitle =
      row.kind === "general"
        ? "Your general thread"
        : row.kind === "topic"
          ? [entry?.jobTitle, row.subtitle].filter(Boolean).join(" · ")
          : entry?.jobTitle || "Direct message";
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => setOpenKey(row.key)}
        className={`w-full flex items-start gap-2.5 px-4 py-3 text-left border-b border-border transition-colors ${
          active ? "bg-accent/[0.07]" : "hover:bg-black/[0.02]"
        }`}
        style={active ? { boxShadow: "inset 3px 0 0 var(--ttc-blue)" } : undefined}
      >
        <span
          className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
          style={{ background: "var(--ttc-blue)" }}
        >
          {row.kind === "general" ? <UserCircleIcon className="h-4 w-4" /> : initialsOf(row.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{row.name}</p>
          <p className="text-xs text-muted truncate mt-0.5">{subtitle}</p>
        </div>
        {row.kind !== "general" && row.unread > 0 && (
          <span className="h-2 w-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--ttc-blue)" }} />
        )}
      </button>
    );
  }

  /** Desktop redesign — the right pane: a header showing who this conversation is with (name,
   *  job title/department for a topic or DM row, plus email for a DM — CB: "each person's name,
   *  title, and basic information should also be visible"), then that same thread component
   *  full-height below it via its new `fill` prop instead of its usual capped-height card. */
  function renderThreadPane(row: Row) {
    const entry = row.kind !== "general" ? directoryById.get(rowEmployeeId(row) ?? "") : undefined;
    const meta =
      row.kind === "general"
        ? "Your general thread"
        : row.kind === "topic"
          ? [entry?.jobTitle, row.subtitle].filter(Boolean).join(" · ")
          : [entry?.jobTitle, entry?.department].filter(Boolean).join(" · ");
    return (
      <>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border shrink-0">
          <span
            className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0"
            style={{ background: "var(--ttc-blue)" }}
          >
            {row.kind === "general" ? <UserCircleIcon className="h-5 w-5" /> : initialsOf(row.name)}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{row.name}</p>
            <p className="text-xs text-muted truncate">
              {meta}
              {row.kind === "dm" && entry?.email ? ` · ${entry.email}` : ""}
            </p>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {row.kind === "general" && (
            <TeamNotesThread employeeId={viewerId} viewerId={viewerId} onRead={() => router.refresh()} fill />
          )}
          {row.kind === "topic" && (
            <TeamNotesThread
              employeeId={row.c.employeeId}
              viewerId={viewerId}
              topicType={row.c.topicType}
              topicId={row.c.topicId}
              topicDate={row.c.topicDate ?? undefined}
              onRead={() => router.refresh()}
              fill
            />
          )}
          {row.kind === "dm" && (
            <DirectMessageThread
              otherEmployeeId={row.employeeId}
              viewerId={viewerId}
              canUseInternalNotes={canUseInternalNotes}
              initialRef={pendingRef}
              onInitialRefConsumed={() => setPendingRef(null)}
              onRead={() => router.refresh()}
              fill
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div className={isDesktop ? "max-w-6xl" : "max-w-3xl"}>
      {!isDesktop && (
        <>
          <div className="flex items-center justify-between gap-3 mb-1">
            <h1 className="page-title text-2xl">My Messages</h1>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="btn-primary text-sm px-3.5 py-2 flex items-center gap-1.5 shrink-0"
            >
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
        </>
      )}

      {isDesktop && (
        <>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h1 className="page-title text-2xl">My Messages</h1>
              <p className="text-sm text-muted mt-0.5">Hi {viewerName} — every conversation in one place.</p>
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="btn-primary text-sm px-3.5 py-2 flex items-center gap-1.5 shrink-0"
            >
              <span className="text-base leading-none">+</span>
              New message
            </button>
          </div>
          <div className="flex h-[70vh] min-h-[420px] rounded-2xl border border-border overflow-hidden bg-surface shadow-sm">
            <div className="w-[300px] shrink-0 border-r border-border flex flex-col overflow-y-auto">
              {renderListRow(generalRow)}
              {rows.map(renderListRow)}
            </div>
            <div className="flex-1 min-w-0 flex flex-col">{renderThreadPane(selectedRow)}</div>
          </div>
        </>
      )}

      {pickerOpen && <NewMessagePicker viewerId={viewerId} onPick={handlePick} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
