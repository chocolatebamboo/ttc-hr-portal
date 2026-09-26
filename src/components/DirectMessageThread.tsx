"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { DownloadIcon, ChecklistIcon, CalendarIcon, LockIcon, ClockIcon, ChatIcon } from "@/components/icons";
import { QUICK_REACTION_EMOJIS } from "@/types";
import type { DirectMessageDTO, DirectMessageThreadDTO, DirectScheduledMessageDTO, DirectoryEntryDTO } from "@/types";

/** What a "Message about this date" link (Phase 5d), the card-level chat icon (round two), or an
 *  already-sent message's own `ref` actually is today — only ever AVAILABILITY_DATE from the
 *  client side (see postMessage's own doc comment in src/lib/direct-messages.ts for why DATE_TASK
 *  stays server-only). `date` is null for the card-level icon, which references the whole
 *  request rather than one date — see openChat's own doc comment in TeamAvailabilityCards.tsx. */
type AttachedRef = { type: "AVAILABILITY_DATE"; id: string; date: string | null };

type LoadState = "loading" | "ready" | "error";

/** "Sep 9, 3:45 PM" — same shape formatNoteTime uses in TeamNotesThread. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** "Wed, Sep 24" from a "YYYY-MM-DD" ref date — same shape DateTaskRow's own formatTaskDate
 *  uses, kept as a tiny local copy since this file has no reason to import a task-specific
 *  helper otherwise. */
function formatRefDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** A one-line preview of a message's content — used for the "Scheduled" queue list. Mirrors how
 *  `m.body`/`m.hasAttachment` already render in the bubble itself, just squeezed to one line. */
function previewText(m: { body: string; hasAttachment: boolean; attachmentName?: string | null }): string {
  if (m.body) return m.body;
  if (m.hasAttachment) return m.attachmentName || "Attachment";
  return "";
}

/** Phase 5c (CB, Sept 2026): "mention a colleague by typing @ followed by their name." Splits a
 *  message body into plain-text and mention segments for rendering, matching ONLY names that are
 *  actually in `names` (the loaded directory) — free-typed "@something" that doesn't match a real
 *  teammate just stays plain text rather than guessing, same "only render what can actually be
 *  resolved" spirit as DirectMessageRefDTO's server-resolved `label`. Longest names sorted first
 *  so "Jordan Rivera" wins over a shorter "Jordan" that might also be someone's name. */
function splitMentions(body: string, names: string[]): { text: string; isMention: boolean }[] {
  if (names.length === 0 || !body.includes("@")) return [{ text: body, isMention: false }];
  const pattern = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`@(?:${pattern})\\b`, "g");
  const parts: { text: string; isMention: boolean }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    if (match.index > lastIndex) parts.push({ text: body.slice(lastIndex, match.index), isMention: false });
    parts.push({ text: match[0], isMention: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) parts.push({ text: body.slice(lastIndex), isMention: false });
  return parts.length > 0 ? parts : [{ text: body, isMention: false }];
}

/** The "@query" the compose box is currently mid-typing, if any — `start` is where the "@" sits
 *  in `text` so a pick can splice it back out precisely. A space (or any whitespace) between the
 *  "@" and the cursor ends the trigger, same as every other @mention composer's own convention,
 *  so "check with @ Jordan" (a stray "@" with nothing following) or plain old "3 @ 5pm" never
 *  opens the dropdown. */
function detectMentionTrigger(text: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor);
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;
  const query = upToCursor.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/** "today at 3:45 PM" / "Sep 28 at 9:00 AM" style label for a pending scheduled message — just
 *  enough precision to tell it apart from another one queued the same day, without pulling in a
 *  date library for one small label. */
function formatScheduledFor(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today at ${time}`;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date} at ${time}`;
}

/** A message's quick-reaction row. All six QUICK_REACTION_EMOJIS render every time, not just the
 *  ones already in use — tapping one toggles it on/off for the viewer; a count badge only shows
 *  once someone's actually reacted. Shared between a top-level message and a reply inside an open
 *  thread panel, so this is its own small component rather than inlined twice.
 *
 *  CB, Sept 2026, comparing against the QUO app reference: "I'm seeing all the emojis and all the
 *  internal messaging" showing under every message at once — too busy, didn't match the
 *  reference's clean bubble-only look. Confirmed scope: "tuck them away until needed." This row
 *  (and MessageActionRow below it) no longer render inline by default; MessageBubble now only
 *  shows them once that one message has been long-pressed (held down) — see MessageBubble's own
 *  doc comment for the gesture. Supersedes the previous round's "always-visible row" call, which
 *  turned out to be the wrong read of the mockup.
 *
 *  Round two, same context, against her phone's native Messages long-press (reaction pill row
 *  sitting above the held message): "when I hold down on one of the message[s]... emojis are
 *  supposed to show up at the top of the message." MessageBubble now renders this row (and the
 *  action menu below it) BEFORE the bubble in document flow rather than after — see
 *  MessageBubble's own render for why that's a plain reorder, not the absolute positioning that
 *  caused the earlier clipping bug. */
function ReactionRow({
  reactions,
  busy,
  onToggle,
}: {
  reactions: DirectMessageDTO["reactions"];
  busy: boolean;
  onToggle: (emoji: string) => void;
}) {
  const byEmoji = new Map(reactions.map((r) => [r.emoji, r]));
  return (
    <div className="flex flex-wrap gap-1">
      {QUICK_REACTION_EMOJIS.map((emoji) => {
        const r = byEmoji.get(emoji);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            disabled={busy}
            className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs disabled:opacity-60 ${
              r?.reactedByMe ? "bg-accent/15 border-accent" : "bg-black/[0.03] border-border hover:bg-black/[0.06]"
            }`}
          >
            <span>{emoji}</span>
            {r && r.count > 0 && <span className="font-medium text-muted">{r.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The message's own action menu — Reply (or "N replies →" once a thread exists), Add internal
 *  note (staff only), Schedule message. CB, Sept 2026, comparing against her phone's native
 *  Messages long-press menu (Reply / Attach Sticker / Copy / Translate / Select / Speak / More…,
 *  stacked in a rounded vertical list): "the reply and the other sub categories... need to...
 *  be vertical... like they're supposed to show" — replaces this round's earlier horizontal
 *  text-link row with the same vertical, divided, rounded-menu shape as that reference. Sept
 *  2026 reply-chain redesign (still true here): replaces the OLDER floating icon-only toolbar
 *  that used to open on tap/hover above the bubble via absolute positioning (that toolbar's
 *  `-top-11` offset is what caused the mobile clipping bug fixed earlier this same round) —
 *  this menu stays in normal document flow (see MessageBubble's own render order below, which
 *  now places it above the bubble without ever absolutely positioning it), so it still can't be
 *  clipped by the thread's own scroll container the way that older toolbar could. "Schedule
 *  message" always opens the SAME shared composer at the bottom of the whole thread (see
 *  `onSchedule` below) — it starts a new message to this conversation, not a reply anchored to
 *  whichever message's menu you opened it from; the mockup put one "Schedule message" entry per
 *  message, but there's only ever one thing to schedule (a fresh message), so this keeps a single
 *  shared composer rather than duplicating scheduling state per message. */
function MessageActionRow({
  replyCount,
  canUseInternalNotes,
  onReply,
  onNote,
  onSchedule,
}: {
  replyCount?: number;
  canUseInternalNotes: boolean;
  onReply?: () => void;
  onNote: () => void;
  onSchedule: () => void;
}) {
  return (
    <div className="mt-1.5 w-48 rounded-2xl border border-border bg-surface shadow-lg overflow-hidden divide-y divide-border">
      {onReply && (
        <button
          type="button"
          onClick={onReply}
          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-left hover:bg-black/[0.04]"
        >
          <span>{replyCount && replyCount > 0 ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Reply"}</span>
          <ChatIcon className="h-4 w-4 text-muted shrink-0" />
        </button>
      )}
      {canUseInternalNotes && (
        <button
          type="button"
          onClick={onNote}
          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-left hover:bg-black/[0.04]"
        >
          <span>Add internal note</span>
          <LockIcon className="h-4 w-4 text-muted shrink-0" />
        </button>
      )}
      <button
        type="button"
        onClick={onSchedule}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-left hover:bg-black/[0.04]"
      >
        <span>Schedule message</span>
        <ClockIcon className="h-4 w-4 text-muted shrink-0" />
      </button>
    </div>
  );
}

/** How long a press has to hold before it counts as "long" and reveals a message's reactions/
 *  actions — CB: "hold down on the message and then it pops up under the specific message."
 *  Long enough that an ordinary tap/scroll never triggers it, short enough that it still reads as
 *  an immediate response once you do hold. */
const LONG_PRESS_MS = 450;
/** How far a pointer can drift while held before this counts as a scroll/drag instead of a long
 *  press — cancels the timer so swiping past a bubble on the way to scrolling the list never
 *  pops its actions open. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/** One message bubble — shared between the main list (top-level messages) and the thread panel
 *  (a root plus its replies), so the bubble/attachment/mention/timestamp markup isn't written
 *  twice. A real top-level component (not one nested inside DirectMessageThread's own body) —
 *  everything it needs comes in as a prop rather than a closure, so its internal state (the
 *  note-draft textarea, in particular) doesn't get reset on every parent re-render the way a
 *  function defined inside another component's render would. `actions` renders whatever
 *  MessageActionRow the caller wants under it (different for a top-level message vs. one
 *  already inside an open thread — see DirectMessageThread's own call sites below).
 *
 *  CB, Sept 2026 (see ReactionRow's own doc comment for the full context): reactions and the
 *  action row are tucked away by default now — `revealed` is true only for whichever ONE message
 *  (across the whole thread) is currently held open, tracked by DirectMessageThread itself so
 *  only one can ever be open at a time. This bubble owns the actual gesture: holding down
 *  (`onPointerDown`) for LONG_PRESS_MS calls `onReveal()`; releasing early, dragging past the
 *  tolerance above, or a genuine short tap anywhere cancels/clears it via `onDismissReveal()`
 *  instead — see handleClick below for why a short tap always dismisses rather than only
 *  dismissing this specific bubble. */
function MessageBubble({
  m,
  viewerId,
  directoryNames,
  reactingId,
  onToggleReaction,
  downloadingId,
  onDownload,
  canUseInternalNotes,
  noteDraftId,
  noteDraftBody,
  noteSubmitting,
  onNoteDraftBodyChange,
  onCancelNoteDraft,
  onSubmitNote,
  isLastMine,
  otherLastReadAt,
  actions,
  revealed,
  onReveal,
  onDismissReveal,
}: {
  m: DirectMessageDTO;
  viewerId: string;
  directoryNames: string[];
  reactingId: string | null;
  onToggleReaction: (messageId: string, emoji: string) => void;
  downloadingId: string | null;
  onDownload: (messageId: string) => void;
  canUseInternalNotes: boolean;
  noteDraftId: string | null;
  noteDraftBody: string;
  noteSubmitting: boolean;
  onNoteDraftBodyChange: (value: string) => void;
  onCancelNoteDraft: () => void;
  onSubmitNote: (messageId: string) => void;
  isLastMine: boolean;
  otherLastReadAt: string | null;
  actions: React.ReactNode;
  /** Whether THIS message's reactions/actions are the ones currently held open. */
  revealed: boolean;
  /** Fires once the hold has lasted long enough — opens this message specifically. */
  onReveal: () => void;
  /** Fires on a short tap (anywhere) or a canceled hold — closes whichever message is open, this
   *  one or another, so tapping a different bubble while one is revealed closes it in one tap
   *  rather than needing two. */
  onDismissReveal: () => void;
}) {
  const mine = m.senderId === viewerId;
  // Long-press detection — see this component's own doc comment above. A ref (not state) for the
  // timer and the "did it actually fire" flag: neither should ever trigger a re-render on its own,
  // just gate what the eventual pointerup/click does.
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  function clearPressTimer() {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return; // right/middle click — leave alone
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressFiredRef.current = false;
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      onReveal();
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = pressStartRef.current;
    if (!start) return;
    if (
      Math.abs(e.clientX - start.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
      Math.abs(e.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    ) {
      clearPressTimer();
    }
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    // Stop this from also being read as an "outside" tap by the scroll container's own dismiss
    // handler further down — a click that landed on a bubble is handled entirely right here.
    e.stopPropagation();
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return; // the hold already opened this one — the trailing click shouldn't also close it
    }
    onDismissReveal();
  }

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {m.ref &&
        (() => {
          const RefIcon = m.ref!.type === "AVAILABILITY_DATE" ? CalendarIcon : ChecklistIcon;
          const refKind = m.ref!.type === "AVAILABILITY_DATE" ? "Availability" : "Task";
          return (
            <div className="max-w-[80%] mb-1 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                <RefIcon className="h-3 w-3" />
                {refKind}
                {m.ref!.date ? ` · ${formatRefDate(m.ref!.date)}` : ""}
              </div>
              <p className="text-xs font-semibold mt-0.5">{m.ref!.label}</p>
            </div>
          );
        })()}

      {/* CB, Sept 2026 (see ReactionRow's own doc comment above): rendered here, before the
          bubble itself, so the reaction row and action menu sit visually above the message —
          "emojis are supposed to show up at the top of the message" — as a plain reorder in
          normal document flow, never absolutely positioned (that's what caused the earlier
          mobile clipping bug this round already fixed once). */}
      {revealed && (
        <div className={`mb-1.5 ${mine ? "self-end" : "self-start"}`}>
          <ReactionRow reactions={m.reactions} busy={reactingId === m.id} onToggle={(emoji) => onToggleReaction(m.id, emoji)} />
          {actions}
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 select-none ${mine ? "text-white" : "bg-black/[0.04]"}`}
        style={mine ? { background: "var(--ttc-blue)" } : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearPressTimer}
        onPointerLeave={clearPressTimer}
        onPointerCancel={clearPressTimer}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleClick}
      >
        {!mine && <p className="text-xs font-semibold mb-0.5">{m.senderName}</p>}
        {m.body && (
          <p className="text-sm whitespace-pre-wrap break-words">
            {splitMentions(m.body, directoryNames).map((part, i) =>
              part.isMention ? (
                <span
                  key={i}
                  className={`font-semibold ${mine ? "underline decoration-white/50 underline-offset-2" : ""}`}
                  style={!mine ? { color: "var(--ttc-blue-ink)" } : undefined}
                >
                  {part.text}
                </span>
              ) : (
                <span key={i}>{part.text}</span>
              )
            )}
          </p>
        )}
        {m.hasAttachment && (
          <button
            onClick={() => onDownload(m.id)}
            disabled={downloadingId === m.id}
            className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium underline ${mine ? "text-white/90" : "text-accent-ink"}`}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {m.attachmentName ?? "Attachment"}
          </button>
        )}
        <p className={`text-[11px] mt-1 ${mine ? "text-white/70" : "text-muted"}`}>{formatMessageTime(m.createdAt)}</p>
      </div>

      {canUseInternalNotes && (m.comments.length > 0 || noteDraftId === m.id) && (
        <div className="max-w-[86%] mt-1 rounded-xl border border-dashed border-border bg-black/[0.025] px-3 py-2">
          {m.comments.length > 0 && (
            <div className={`space-y-2 ${noteDraftId === m.id ? "mb-2" : ""}`}>
              {m.comments.map((c) => (
                <div key={c.id}>
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                    <LockIcon className="h-2.5 w-2.5" />
                    Internal note
                  </p>
                  <p className="text-xs mt-0.5">{c.body}</p>
                  <p className="text-[10px] text-muted mt-0.5">
                    {c.authorName} · {formatMessageTime(c.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
          {noteDraftId === m.id && (
            <div className="space-y-1.5">
              <textarea
                autoFocus
                value={noteDraftBody}
                onChange={(e) => onNoteDraftBodyChange(e.target.value)}
                placeholder="Note for staff only…"
                rows={2}
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent resize-none"
              />
              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={onCancelNoteDraft} className="text-xs text-muted hover:text-accent-ink">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onSubmitNote(m.id)}
                  disabled={noteSubmitting || !noteDraftBody.trim()}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  {noteSubmitting ? "Posting…" : "Post note"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isLastMine && otherLastReadAt && m.createdAt <= otherLastReadAt && <p className="text-[10px] text-muted mt-0.5">Seen</p>}
    </div>
  );
}

/**
 * CB, Sept 2026: "instead of notes, I want it to be messages, and the functionality needs to
 * appear almost like any text message... look up members and send them individual messages...
 * have an internal, I guess, conversation there." A real peer-to-peer DM thread with one other
 * employee (`otherEmployeeId`) — same bubble layout TeamNotesThread already uses (right-aligned
 * for the viewer, left-aligned with a name label for them), but talking to /api/messages/dm
 * instead of /api/team-notes, since a DM isn't scoped to anyone's HR record the way a TeamNote
 * thread is. Kept as its own component rather than teaching TeamNotesThread a second API shape
 * — the two threads' access rules and endpoints are different enough that sharing one component
 * would mean branching on "which kind of thread is this" throughout.
 *
 * Round two (Sept 2026), CB, on a DM thread with Daijour: "I should be able to click on the
 * message that I sent [to reply to it]. I should have the options to include emojis to react to
 * other people's replies. I should be able to see also when they read the message on their side.
 * And then also I should be able to reply to a specific message within the message thread."
 *
 * Phase 5b/5c (Sept 2026): quick-emoji reactions, an @mention autocomplete, and staff-only
 * internal notes, first shipped as a hover/tap-to-reveal floating toolbar above each bubble.
 *
 * Reply-chain redesign (Sept 2026, "Reply chain" mockup CB confirmed for deployment — "fix now
 * its supposed to look like the mockup"): three confirmed changes on top of all of the above,
 * replacing the 5b/5c toolbar entirely:
 *   1. Reactions are now an ALWAYS-VISIBLE row under every message (not tap/hover-to-reveal).
 *   2. Replies now group into a collapsed "N replies →" thread under their top-level message
 *      (Slack-thread style) instead of each reply showing its own inline quoted-preview card —
 *      see DirectMessageDTO's own `chainRootId`/`replyCount` doc comments in src/types/index.ts
 *      for how the flat `messages` array gets grouped into threads. Tapping it opens the panel
 *      below: a full-viewport blurred-backdrop overlay with the root message, its replies, and
 *      a reply box that always targets that same root.
 *   3. "Schedule message" — genuinely new, wasn't built before this round. Composing a message
 *      can be scheduled for a future date/time instead of sent immediately; see the compose
 *      form's own scheduling toggle below and DirectScheduledMessageDTO's doc comment in
 *      src/types/index.ts for how a still-pending one stays invisible until it goes out.
 */
export default function DirectMessageThread({
  otherEmployeeId,
  viewerId,
  canUseInternalNotes,
  initialRef,
  onInitialRefConsumed,
  onMessagePosted,
  onRead,
  fill = false,
}: {
  otherEmployeeId: string;
  viewerId: string;
  /** Phase 5c: whether the signed-in viewer may see/post internal notes on this thread's
   *  messages — SUPER_ADMIN/HR_ADMIN/SUPERVISOR (isStaff(), src/lib/authorization.ts), passed
   *  down from the page rather than re-derived here since this component never receives the
   *  viewer's full role otherwise. */
  canUseInternalNotes: boolean;
  /** Phase 5d: a reference to pre-attach on mount, or null/undefined for none — see this
   *  component's own doc comment above. Only ever read once, at mount (matching how `dm`/`name`
   *  already seed a fresh thread) — a later change to this prop while the thread stays open does
   *  NOT re-seed `attachedRef`. */
  initialRef?: AttachedRef | null;
  /** Fires once, right after `initialRef` has been captured into local state — lets the parent
   *  clear its own copy so it isn't handed to some other thread later. */
  onInitialRefConsumed?: () => void;
  /** Fires after a message is successfully sent — lets the inbox list above refresh its
   *  conversation summary (last message, counts) without waiting for the next full page load. */
  onMessagePosted?: () => void;
  /** Fires after this thread's messages successfully load — the moment listMessages marks it
   *  read for the viewer server-side (see its own comment in src/lib/direct-messages.ts). Same
   *  reasoning as TeamNotesThread's own onRead. */
  onRead?: () => void;
  /** Desktop two-pane redesign (CB, Sept 2026, approved mockup): renders edge-to-edge, filling
   *  its parent's height, instead of this thread's usual card chrome (own border/rounded
   *  corners) and fixed max-height — see TeamNotesThread's own `fill` doc comment, which this
   *  mirrors exactly. Defaults to false so the mobile inline-accordion rendering (and every
   *  other caller) is completely unaffected. */
  fill?: boolean;
}) {
  const [messages, setMessages] = useState<DirectMessageDTO[]>([]);
  const [scheduled, setScheduled] = useState<DirectScheduledMessageDTO[]>([]);
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Phase 5d: the reference about to ride along on the next send, if any — seeded once from
  // `initialRef` below, cleared on send (or manually via the attach-chip's own Cancel).
  const [attachedRef, setAttachedRef] = useState<AttachedRef | null>(initialRef ?? null);
  // Which message has a reaction toggle in flight — just disables that message's own pills/
  // picker while it's happening, same narrow busy-scoping every other list in this app uses.
  const [reactingId, setReactingId] = useState<string | null>(null);
  // CB, Sept 2026 (see ReactionRow's own doc comment): which ONE message's reactions/actions are
  // currently held open via long-press — null means every message is showing just its plain
  // bubble. Shared across both the main list and the thread panel (only one is ever visible at a
  // time anyway), and reset to null on any plain tap anywhere — see MessageBubble's handleClick.
  const [revealedMessageId, setRevealedMessageId] = useState<string | null>(null);
  // Phase 5c: which message's internal-note composer is open, and its in-progress text — at
  // most one at a time, same "one draft slot" shape every other single-item draft in this
  // component uses (e.g. `threadPanelRootId` further down).
  const [noteDraftId, setNoteDraftId] = useState<string | null>(null);
  const [noteDraftBody, setNoteDraftBody] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  // Phase 5c: the org directory, loaded once — backs both the @mention dropdown's suggestions
  // and splitMentions' own highlight-matching (see that function's doc comment above).
  const [directory, setDirectory] = useState<DirectoryEntryDTO[]>([]);
  // The active "@query" mid-type in the compose box, if any — see detectMentionTrigger above.
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; query: string } | null>(null);
  // Reply-chain redesign: which top-level message's thread panel is open, if any.
  const [threadPanelRootId, setThreadPanelRootId] = useState<string | null>(null);
  const [threadReplyBody, setThreadReplyBody] = useState("");
  const [threadSending, setThreadSending] = useState(false);
  const [threadSendError, setThreadSendError] = useState("");
  // "Schedule message" (Sept 2026): toggles the main compose form's Send button into "Schedule"
  // — a `datetime-local` input appears alongside it. Opened either directly or via any message's
  // own "Schedule message" action link (MessageActionRow above).
  const [schedulingOpen, setSchedulingOpen] = useState(false);
  const [scheduleWhen, setScheduleWhen] = useState("");
  // The earliest pickable moment for the `datetime-local` input's `min` — computed once, in the
  // event handler that opens the picker (openSchedulingComposer below), never during render:
  // reading the current time while rendering is an impure call React's own rules disallow (it
  // would make the component's output depend on when it happened to re-render, not just its
  // props/state), so this is a plain snapshot taken at the moment the sender opens the picker.
  const [scheduleMin, setScheduleMin] = useState("");
  const [cancelingScheduledId, setCancelingScheduledId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/messages/dm/${otherEmployeeId}`);
      if (!res.ok) throw new Error();
      const data: DirectMessageThreadDTO = await res.json();
      setMessages(data.messages);
      setScheduled(data.scheduled);
      setOtherLastReadAt(data.otherLastReadAt);
      setLoadState("ready");
      onRead?.();
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherEmployeeId]);

  // Phase 5d: tells the parent its `initialRef` has been captured (into `attachedRef` above, via
  // useState's initializer) so it can clear its own copy — mount-only, same "consume once" shape
  // the `dm`/`name`/`refType`… URL params already follow one level up.
  useEffect(() => {
    if (initialRef) onInitialRefConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  // Phase 5c: the org directory backing @mentions — loaded once per mount, same "this company's
  // small enough, no server-side search needed" reasoning NewMessagePicker's own comment gives
  // for reusing this same /api/directory list.
  useEffect(() => {
    async function loadDirectory() {
      try {
        const res = await fetch("/api/directory");
        if (!res.ok) return;
        const data: { directory: DirectoryEntryDTO[] } = await res.json();
        setDirectory(data.directory.filter((e) => e.id !== viewerId));
      } catch {
        // A failed directory load just means no mention suggestions/highlighting this session —
        // never worth surfacing as a thread-load error, the conversation itself still works.
      }
    }
    loadDirectory();
  }, [viewerId]);

  const directoryNames = useMemo(() => directory.map((e) => e.name), [directory]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionTrigger) return [];
    const q = mentionTrigger.query.trim().toLowerCase();
    const pool = q ? directory.filter((e) => e.name.toLowerCase().includes(q)) : directory;
    return pool.slice(0, 5);
  }, [mentionTrigger, directory]);

  // Reply-chain redesign: the flat `messages` array grouped into threads — every top-level
  // message (chainRootId === null) in display order, and a lookup from a root's id to its own
  // replies (also in order, since `messages` itself already comes back oldest-first). A reply
  // never appears in `topLevel` — it only ever renders inside its own thread's panel below.
  const topLevel = useMemo(() => messages.filter((m) => m.chainRootId === null), [messages]);
  const repliesByRoot = useMemo(() => {
    const map = new Map<string, DirectMessageDTO[]>();
    for (const m of messages) {
      if (!m.chainRootId) continue;
      const arr = map.get(m.chainRootId) ?? [];
      arr.push(m);
      map.set(m.chainRootId, arr);
    }
    return map;
  }, [messages]);
  const threadPanelRoot = threadPanelRootId ? messages.find((m) => m.id === threadPanelRootId) ?? null : null;
  const threadPanelReplies = threadPanelRootId ? repliesByRoot.get(threadPanelRootId) ?? [] : [];

  function openSchedulingComposer() {
    setSchedulingOpen(true);
    setScheduleMin(new Date(Date.now() + 60000).toISOString().slice(0, 16));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && !file) return;
    if (schedulingOpen && !scheduleWhen) {
      setSendError("Pick a date and time to schedule this for.");
      return;
    }

    setSending(true);
    setSendError("");
    try {
      const form = new FormData();
      form.set("body", body);
      if (file) form.set("file", file);
      if (attachedRef) {
        form.set("refType", attachedRef.type);
        form.set("refId", attachedRef.id);
        // Round two: a card-level ref has no date (see AttachedRef's own doc comment) — omitted
        // entirely rather than sent as the string "null", so the API route's own refDate?
        // check treats it exactly like it was never there.
        if (attachedRef.date) form.set("refDate", attachedRef.date);
      }
      if (schedulingOpen && scheduleWhen) {
        form.set("scheduledFor", new Date(scheduleWhen).toISOString());
      }

      const res = await fetch(`/api/messages/dm/${otherEmployeeId}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error ?? "Couldn't send that. Please try again.");
        return;
      }
      setBody("");
      setFile(null);
      setAttachedRef(null);
      setMentionTrigger(null);
      setSchedulingOpen(false);
      setScheduleWhen("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      load();
      onMessagePosted?.();
    } catch {
      setSendError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleThreadReply(rootId: string) {
    if (!threadReplyBody.trim()) return;
    setThreadSending(true);
    setThreadSendError("");
    try {
      const form = new FormData();
      form.set("body", threadReplyBody);
      form.set("replyToId", rootId);
      const res = await fetch(`/api/messages/dm/${otherEmployeeId}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setThreadSendError(data.error ?? "Couldn't send that. Please try again.");
        return;
      }
      setThreadReplyBody("");
      load();
      onMessagePosted?.();
    } catch {
      setThreadSendError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setThreadSending(false);
    }
  }

  async function handleDownload(messageId: string) {
    setDownloadingId(messageId);
    try {
      const res = await fetch(`/api/messages/dm/${otherEmployeeId}/${messageId}/download`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setDownloadingId(null);
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setReactingId(messageId);
    try {
      const res = await fetch(`/api/messages/dm/${otherEmployeeId}/${messageId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.reactions) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions } : m)));
      }
    } finally {
      setReactingId(null);
    }
  }

  // Phase 5c: opens/closes a message's internal-note composer — at most one open at a time.
  function toggleNoteDraft(m: DirectMessageDTO) {
    setNoteDraftId(noteDraftId === m.id ? null : m.id);
    setNoteDraftBody("");
  }

  async function submitNote(messageId: string) {
    if (!noteDraftBody.trim()) return;
    setNoteSubmitting(true);
    try {
      const res = await fetch(`/api/messages/dm/${otherEmployeeId}/${messageId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteDraftBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.comments) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, comments: data.comments } : m)));
        setNoteDraftBody("");
        setNoteDraftId(null);
      }
    } finally {
      setNoteSubmitting(false);
    }
  }

  async function cancelScheduled(id: string) {
    setCancelingScheduledId(id);
    try {
      const res = await fetch(`/api/messages/dm/${otherEmployeeId}/scheduled/${id}`, { method: "DELETE" });
      if (res.ok) {
        setScheduled((prev) => prev.filter((s) => s.id !== id));
      }
    } finally {
      setCancelingScheduledId(null);
    }
  }

  /** Splices the picked directory entry's name into the compose box in place of the "@query"
   *  that triggered the dropdown, then puts the cursor right after it — same "insert and keep
   *  typing" flow as every other @mention composer. */
  function pickMention(entry: DirectoryEntryDTO) {
    if (!mentionTrigger) return;
    const before = body.slice(0, mentionTrigger.start);
    const after = body.slice(mentionTrigger.start + 1 + mentionTrigger.query.length);
    const inserted = `@${entry.name} `;
    const next = `${before}${inserted}${after}`;
    setBody(next);
    setMentionTrigger(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const cursor = before.length + inserted.length;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  // The last message the viewer themselves sent — the one and only bubble a "Seen" mark can ever
  // appear under, same as a normal texting app never stamping every message with its own receipt.
  const lastMineId = [...messages].reverse().find((m) => m.senderId === viewerId)?.id ?? null;

  return (
    <div className={fill ? "h-full flex flex-col" : "bg-surface border border-border rounded-2xl overflow-hidden"}>
      <div
        className={fill ? "flex-1 min-h-0 overflow-y-auto p-4 space-y-3" : "p-4 space-y-3 max-h-[28rem] overflow-y-auto"}
        onClick={() => setRevealedMessageId(null)}
      >
        {loadState === "loading" && (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 w-2/3 rounded-2xl bg-black/[0.04] animate-pulse" />
            ))}
          </div>
        )}

        {loadState === "error" && (
          <div className="text-sm text-accent">Unable to load this conversation. Please try again or contact support.</div>
        )}

        {loadState === "ready" && topLevel.length === 0 && (
          <div className="text-sm text-muted">No messages yet — say hello.</div>
        )}

        {loadState === "ready" &&
          topLevel.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              viewerId={viewerId}
              directoryNames={directoryNames}
              reactingId={reactingId}
              onToggleReaction={toggleReaction}
              downloadingId={downloadingId}
              onDownload={handleDownload}
              canUseInternalNotes={canUseInternalNotes}
              noteDraftId={noteDraftId}
              noteDraftBody={noteDraftBody}
              noteSubmitting={noteSubmitting}
              onNoteDraftBodyChange={setNoteDraftBody}
              onCancelNoteDraft={() => {
                setNoteDraftId(null);
                setNoteDraftBody("");
              }}
              onSubmitNote={submitNote}
              isLastMine={m.id === lastMineId}
              otherLastReadAt={otherLastReadAt}
              actions={
                <MessageActionRow
                  replyCount={m.replyCount}
                  canUseInternalNotes={canUseInternalNotes}
                  onReply={() => setThreadPanelRootId(m.id)}
                  onNote={() => toggleNoteDraft(m)}
                  onSchedule={openSchedulingComposer}
                />
              }
              revealed={revealedMessageId === m.id}
              onReveal={() => setRevealedMessageId(m.id)}
              onDismissReveal={() => setRevealedMessageId(null)}
            />
          ))}
        <div ref={bottomRef} />
      </div>

      {/* "Schedule message" (Sept 2026): the sender's own still-pending queue for this thread —
          never anyone else's (the API only ever returns the caller's own). Shown above the
          compose box so it reads as "what's about to go out" rather than mixed in with delivered
          messages. */}
      {scheduled.length > 0 && (
        <div className="border-t border-border bg-black/[0.015] px-3 py-2 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Scheduled</p>
          {scheduled.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
              <div className="min-w-0">
                <p className="text-xs truncate">{previewText(s)}</p>
                <p className="text-[10px] text-muted">Sends {formatScheduledFor(s.scheduledFor)}</p>
              </div>
              <button
                type="button"
                onClick={() => cancelScheduled(s.id)}
                disabled={cancelingScheduledId === s.id}
                className="text-xs text-muted hover:text-accent-ink shrink-0 disabled:opacity-60"
              >
                {cancelingScheduledId === s.id ? "Canceling…" : "Cancel"}
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="border-t border-border p-3 space-y-2">
        {/* Phase 5d: what's about to go out, from a "Message about this date" link — cleared by
            its own Cancel, or automatically once the message that carries it actually sends. */}
        {attachedRef && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            style={{ background: "rgba(1,105,240,0.07)", borderColor: "rgba(1,105,240,0.25)" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-brand-ink" />
              <p className="text-xs truncate">
                {attachedRef.date ? (
                  <>
                    Attached: <span className="font-semibold text-brand-ink">{formatRefDate(attachedRef.date)}</span> availability
                  </>
                ) : (
                  <>
                    Attached: <span className="font-semibold text-brand-ink">availability request</span>
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAttachedRef(null)}
              className="text-xs text-muted hover:text-accent-ink shrink-0"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="relative">
          {/* Phase 5c: @mention dropdown — CB, "team members should also be able to mention a
              colleague by typing @ followed by their name." Floats above the compose box (same
              place a mention dropdown always sits, so it can open even on the very first line)
              rather than trying to track on-screen caret coordinates inside a plain textarea,
              which would need a much heavier composer than this app has anywhere else. Closed
              on blur with a short delay so a click on a suggestion still registers first. */}
          {mentionTrigger && mentionSuggestions.length > 0 && (
            <div className="absolute left-1 bottom-full mb-1.5 w-64 max-w-[90vw] rounded-xl border border-border bg-surface shadow-lg p-1.5 z-20">
              {mentionSuggestions.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickMention(entry)}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.04]"
                >
                  <span
                    className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ background: "rgba(1,105,240,0.12)", color: "var(--ttc-blue-ink)" }}
                  >
                    {entry.name
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold truncate">{entry.name}</span>
                    <span className="block text-[10px] text-muted truncate">{entry.jobTitle}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              const value = e.target.value;
              setBody(value);
              setMentionTrigger(detectMentionTrigger(value, e.target.selectionStart ?? value.length));
            }}
            onBlur={() => {
              // A click on a suggestion is a mousedown-prevented button (above), so this timeout
              // only ever fires for a REAL blur — clicking away, tabbing off, etc.
              setTimeout(() => setMentionTrigger(null), 150);
            }}
            placeholder="Text message…"
            rows={2}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent resize-none"
          />
        </div>
        {/* "Schedule message" (Sept 2026) — toggled open from here or from any message's own
            "Schedule message" action link (MessageActionRow). Turns the Send button below into
            "Schedule" for this one send. */}
        {schedulingOpen && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-black/[0.02] px-3 py-2">
            <ClockIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input
              type="datetime-local"
              value={scheduleWhen}
              onChange={(e) => setScheduleWhen(e.target.value)}
              min={scheduleMin}
              className="flex-1 min-w-0 rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => {
                setSchedulingOpen(false);
                setScheduleWhen("");
              }}
              className="text-xs text-muted hover:text-accent-ink shrink-0"
            >
              Cancel
            </button>
          </div>
        )}
        {sendError && <p className="text-xs text-accent">{sendError}</p>}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs text-muted max-w-[10rem]"
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
          <button
            type="submit"
            disabled={sending || (!body.trim() && !file) || (schedulingOpen && !scheduleWhen)}
            className="btn-primary text-sm px-4 py-2 shrink-0"
          >
            {sending ? (schedulingOpen ? "Scheduling…" : "Sending…") : schedulingOpen ? "Schedule" : "Send"}
          </button>
        </div>
      </form>

      {/* Reply-chain redesign (Sept 2026, "Reply chain" mockup): "the reply/thread view now
          expands in place right at the message, background blurred behind it — no separate
          screen — and the reply box lives at the bottom of that same panel." A fixed, full-
          viewport overlay rather than confined to this component's own (possibly small,
          possibly not-`fill`) box, since the mockup's blur treats the whole screen behind it as
          the backdrop — the thread panel is the one piece of this component that deliberately
          escapes its own container. */}
      {threadPanelRoot && (
        // CB, Sept 2026, comparing against her own Messages app: "it needs to kinda zoom in...
        // to where whichever message that we're replying to... it's not so far away from the
        // place where I would be typing the messaging box." The old `items-end` mobile layout
        // pinned this panel to the very bottom of the screen while its own height only ever hugs
        // its content — on a short thread (one message, one reply) that left most of the screen
        // as bare blurred backdrop above it, pushing the reply box down to the very bottom edge.
        // Centering on every screen size (previously desktop-only, `sm:items-center`) keeps the
        // panel a compact, content-hugging card wherever it opens, so the blank space is split
        // evenly around it instead of piling up above — the message and the reply box stay close
        // together, never stranded at the bottom of a mostly-empty screen.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface shadow-xl flex flex-col max-h-[85vh]">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 shrink-0">
              <button
                type="button"
                onClick={() => setThreadPanelRootId(null)}
                className="text-sm text-muted hover:text-accent-ink"
              >
                ← Back
              </button>
              <p className="text-sm font-semibold">Thread</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" onClick={() => setRevealedMessageId(null)}>
              <MessageBubble
                m={threadPanelRoot}
                viewerId={viewerId}
                directoryNames={directoryNames}
                reactingId={reactingId}
                onToggleReaction={toggleReaction}
                downloadingId={downloadingId}
                onDownload={handleDownload}
                canUseInternalNotes={canUseInternalNotes}
                noteDraftId={noteDraftId}
                noteDraftBody={noteDraftBody}
                noteSubmitting={noteSubmitting}
                onNoteDraftBodyChange={setNoteDraftBody}
                onCancelNoteDraft={() => {
                  setNoteDraftId(null);
                  setNoteDraftBody("");
                }}
                onSubmitNote={submitNote}
                isLastMine={threadPanelRoot.id === lastMineId}
                otherLastReadAt={otherLastReadAt}
                actions={null}
                revealed={revealedMessageId === threadPanelRoot.id}
                onReveal={() => setRevealedMessageId(threadPanelRoot.id)}
                onDismissReveal={() => setRevealedMessageId(null)}
              />
              {threadPanelReplies.length > 0 && <div className="border-t border-dashed border-border" />}
              {threadPanelReplies.map((r) => (
                <MessageBubble
                  key={r.id}
                  m={r}
                  viewerId={viewerId}
                  directoryNames={directoryNames}
                  reactingId={reactingId}
                  onToggleReaction={toggleReaction}
                  downloadingId={downloadingId}
                  onDownload={handleDownload}
                  canUseInternalNotes={canUseInternalNotes}
                  noteDraftId={noteDraftId}
                  noteDraftBody={noteDraftBody}
                  noteSubmitting={noteSubmitting}
                  onNoteDraftBodyChange={setNoteDraftBody}
                  onCancelNoteDraft={() => {
                    setNoteDraftId(null);
                    setNoteDraftBody("");
                  }}
                  onSubmitNote={submitNote}
                  isLastMine={r.id === lastMineId}
                  otherLastReadAt={otherLastReadAt}
                  actions={
                    canUseInternalNotes ? (
                      <MessageActionRow canUseInternalNotes onNote={() => toggleNoteDraft(r)} onSchedule={openSchedulingComposer} />
                    ) : null
                  }
                  revealed={revealedMessageId === r.id}
                  onReveal={() => setRevealedMessageId(r.id)}
                  onDismissReveal={() => setRevealedMessageId(null)}
                />
              ))}
            </div>
            <div className="border-t border-border p-3 space-y-1.5 shrink-0">
              {threadSendError && <p className="text-xs text-accent">{threadSendError}</p>}
              <div className="flex items-center gap-2">
                <textarea
                  value={threadReplyBody}
                  onChange={(e) => setThreadReplyBody(e.target.value)}
                  placeholder="Reply in thread…"
                  rows={1}
                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent resize-none"
                />
                <button
                  type="button"
                  onClick={() => handleThreadReply(threadPanelRoot.id)}
                  disabled={threadSending || !threadReplyBody.trim()}
                  className="btn-primary text-sm px-4 py-2 shrink-0"
                >
                  {threadSending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
