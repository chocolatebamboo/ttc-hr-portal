"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, ChecklistIcon, CalendarIcon, ReplyIcon, LockIcon } from "@/components/icons";
import { QUICK_REACTION_EMOJIS } from "@/types";
import type { DirectMessageDTO, DirectMessageThreadDTO, DirectoryEntryDTO } from "@/types";

/** What a "Message about this date" link (Phase 5d) or an already-sent message's own `ref`
 *  actually is today — only ever AVAILABILITY_DATE from the client side (see postMessage's own
 *  doc comment in src/lib/direct-messages.ts for why DATE_TASK stays server-only). */
type AttachedRef = { type: "AVAILABILITY_DATE"; id: string; date: string };

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

/** A one-line preview of a message's content — used for both the reply-preview card rendered
 *  above a message that quotes another one, and the "replying to…" draft banner above the
 *  compose box. Mirrors how `m.body`/`m.hasAttachment` already render in the bubble itself, just
 *  squeezed to one line. */
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
 * Confirmed scope (DMs only, a quick ~6-emoji set, quoted inline replies rather than nested
 * threads): tapping a bubble opens a small action row (react / reply) for that one message;
 * `replyingTo` seeds a draft banner above the compose box, cleared on send; reactions render as
 * tap-to-toggle pills under the bubble, same tap-to-toggle shape server-side (toggleReaction in
 * src/lib/direct-messages.ts); and `otherLastReadAt` (from the GET response, see
 * DirectMessageThreadDTO's own doc comment in src/types/index.ts) drives a "Seen" mark under the
 * last message the viewer sent that the other person has already read — iMessage's own read-
 * receipt convention, not a mark on every message.
 *
 * Phase 5b (CB, Sept 2026): "replies should appear within the relevant message thread... show a
 * visible connecting line between the messages, so the conversation is easy to follow" and
 * "hovering over a message should show quick emoji reactions." Two changes on top of the above,
 * both purely presentational — no new endpoints, no DTO changes: (1) a small elbow connector
 * renders next to a reply's existing quoted-preview card, pointing back at what it's answering,
 * rather than the card standing alone; (2) the react/reply row (still the same six
 * QUICK_REACTION_EMOJIS + reply) now floats above the bubble as its own pill, shown on hover for
 * desktop pointer users and still reachable by tapping the bubble on touch devices, where hover
 * doesn't apply — `activeMessageId` drives that tap-open state exactly as before, hover is added
 * on top via CSS (:group-hover), not a second piece of state. Internal-comment and create-task
 * actions are NOT in this toolbar yet — those land in their own later phases and slot into this
 * same pill once built, rather than shipping inert buttons now.
 *
 * Phase 5c (CB, Sept 2026): "hovering over a message should show quick emoji reactions and an
 * option to add an internal comment. Team members should also be able to mention a colleague by
 * typing @ followed by their name." Two independent additions on top of 5b: (1) a fourth toolbar
 * action (lock icon), staff-only per `canUseInternalNotes` — opens a small note composer under
 * that message; posted notes render in their own dashed staff-only panel, never inside the real
 * bubble stream, and the whole action is simply absent from the toolbar for a plain team member
 * rather than shown disabled (see addComment's own doc comment in src/lib/direct-messages.ts for
 * why — the server never lets them learn a note exists either); (2) an @mention autocomplete in
 * the compose box, backed by the same /api/directory list NewMessagePicker already uses for "New
 * message." A mention is stored as plain `@Full Name` text (no structured id, no notification) —
 * splitMentions above only highlights it in a sent bubble when it matches a real directory name,
 * so this needed no DTO or schema change on the sending side at all.
 *
 * Phase 5d (CB, Sept 2026): "chat icons on availability requests linked to specific dates" — a
 * date-scoped chat button (TeamAvailabilityCards' openChatForDate) can open this thread with a
 * reference already attached, seeded from `initialRef` into the same `attachedRef` state a
 * message-scoped reply already uses for `replyingTo` — an attach-chip renders above the compose
 * box showing what's about to go out, clearable before sending, and rides along on the next send
 * as `refType`/`refId`/`refDate`. `onInitialRefConsumed` tells the parent (which owns the actual
 * URL-derived value) that it's been captured, so it can clear its own copy and a later reopen of
 * this or any other thread never inherits a stale reference from an earlier date-chat click.
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
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Which message's own react/reply action row is open — at most one at a time, closed again
  // the moment either action is taken.
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  // The message currently being replied to, if any — seeds the draft banner above the compose
  // box and rides along on the next send as `replyToId`.
  const [replyingTo, setReplyingTo] = useState<DirectMessageDTO | null>(null);
  // Phase 5d: the reference about to ride along on the next send, if any — seeded once from
  // `initialRef` below, cleared on send (or manually via the attach-chip's own Cancel).
  const [attachedRef, setAttachedRef] = useState<AttachedRef | null>(initialRef ?? null);
  // Which message has a reaction toggle in flight — just disables that message's own pills/
  // picker while it's happening, same narrow busy-scoping every other list in this app uses.
  const [reactingId, setReactingId] = useState<string | null>(null);
  // Phase 5c: which message's internal-note composer is open, and its in-progress text — at
  // most one at a time, same "one draft slot" shape `replyingTo` already uses.
  const [noteDraftId, setNoteDraftId] = useState<string | null>(null);
  const [noteDraftBody, setNoteDraftBody] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  // Phase 5c: the org directory, loaded once — backs both the @mention dropdown's suggestions
  // and splitMentions' own highlight-matching (see that function's doc comment above).
  const [directory, setDirectory] = useState<DirectoryEntryDTO[]>([]);
  // The active "@query" mid-type in the compose box, if any — see detectMentionTrigger above.
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; query: string } | null>(null);
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && !file) return;

    setSending(true);
    setSendError("");
    try {
      const form = new FormData();
      form.set("body", body);
      if (file) form.set("file", file);
      if (replyingTo) form.set("replyToId", replyingTo.id);
      if (attachedRef) {
        form.set("refType", attachedRef.type);
        form.set("refId", attachedRef.id);
        form.set("refDate", attachedRef.date);
      }

      const res = await fetch(`/api/messages/dm/${otherEmployeeId}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error ?? "Couldn't send that. Please try again.");
        return;
      }
      setBody("");
      setFile(null);
      setReplyingTo(null);
      setAttachedRef(null);
      setMentionTrigger(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      load();
      onMessagePosted?.();
    } catch {
      setSendError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
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
    setActiveMessageId(null);
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

  function startReply(m: DirectMessageDTO) {
    setReplyingTo(m);
    setActiveMessageId(null);
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

  // Phase 5c: opens/closes a message's internal-note composer — at most one open at a time,
  // same one-draft-slot shape startReply uses for replies.
  function toggleNoteDraft(m: DirectMessageDTO) {
    setNoteDraftId(noteDraftId === m.id ? null : m.id);
    setNoteDraftBody("");
    setActiveMessageId(null);
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

  // The last message the viewer themselves sent — the one and only bubble a "Seen" mark can ever
  // appear under, same as a normal texting app never stamping every message with its own receipt.
  const lastMineId = [...messages].reverse().find((m) => m.senderId === viewerId)?.id ?? null;

  return (
    <div className={fill ? "h-full flex flex-col" : "bg-surface border border-border rounded-2xl overflow-hidden"}>
      {/* Sept 2026: pt-14 (not plain p-4's pt-4) on purpose — the react/reply/note toolbar
          floats 44px (-top-11) above whichever bubble is open, and without enough headroom
          above the very first message in the thread, this box's own overflow-y-auto clips
          that toolbar out of view entirely (not just visually crowded — genuinely invisible,
          no amount of scrolling reveals it, since there's nothing above the container's own
          top edge to scroll to). Every later message has a previous bubble above it to
          overlap into instead, so only the first one was actually broken — but on the
          mobile accordion view (this component without `fill`, capped at max-h-[28rem]) the
          first message is exactly what's on screen right after opening a thread, which is
          almost certainly why CB's phone showed no toolbar at all. */}
      <div className={fill ? "flex-1 min-h-0 overflow-y-auto pt-14 px-4 pb-4 space-y-3" : "pt-14 px-4 pb-4 space-y-3 max-h-[28rem] overflow-y-auto"}>
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

        {loadState === "ready" && messages.length === 0 && (
          <div className="text-sm text-muted">No messages yet — say hello.</div>
        )}

        {loadState === "ready" &&
          messages.map((m) => {
            const mine = m.senderId === viewerId;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                {m.ref &&
                  (() => {
                    const RefIcon = m.ref.type === "AVAILABILITY_DATE" ? CalendarIcon : ChecklistIcon;
                    const refKind = m.ref.type === "AVAILABILITY_DATE" ? "Availability" : "Task";
                    return (
                      <div className="max-w-[80%] mb-1 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          <RefIcon className="h-3 w-3" />
                          {refKind}
                          {m.ref.date ? ` · ${formatRefDate(m.ref.date)}` : ""}
                        </div>
                        <p className="text-xs font-semibold mt-0.5">{m.ref.label}</p>
                      </div>
                    );
                  })()}
                {m.replyTo && (
                  <div className="relative max-w-[80%] mb-1 pl-5">
                    <ReplyIcon aria-hidden="true" className="absolute left-0 top-1 h-3.5 w-3.5 text-muted" />
                    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {messages.find((msg) => msg.id === m.replyTo!.id)?.senderId === viewerId
                          ? "You"
                          : m.replyTo.senderName}
                      </p>
                      <p className="text-xs text-muted truncate">{previewText(m.replyTo)}</p>
                    </div>
                  </div>
                )}
                <div className="group/msg relative">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveMessageId(activeMessageId === m.id ? null : m.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveMessageId(activeMessageId === m.id ? null : m.id);
                      }
                    }}
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 cursor-pointer ${mine ? "text-white" : "bg-black/[0.04]"}`}
                    style={mine ? { background: "var(--ttc-blue)" } : undefined}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(m.id);
                        }}
                        disabled={downloadingId === m.id}
                        className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium underline ${mine ? "text-white/90" : "text-accent-ink"}`}
                      >
                        <DownloadIcon className="h-3.5 w-3.5" />
                        {m.attachmentName ?? "Attachment"}
                      </button>
                    )}
                    <p className={`text-[11px] mt-1 ${mine ? "text-white/70" : "text-muted"}`}>{formatMessageTime(m.createdAt)}</p>
                  </div>

                  <div
                    className={`absolute -top-11 ${mine ? "right-0" : "left-0"} z-10 flex items-center gap-0.5 rounded-full px-1.5 py-1 shadow-lg transition-opacity ${
                      activeMessageId === m.id
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto"
                    }`}
                    style={{ background: "var(--foreground)" }}
                  >
                    {QUICK_REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleReaction(m.id, emoji)}
                        disabled={reactingId === m.id}
                        className="h-7 w-7 rounded-full hover:bg-white/[0.14] flex items-center justify-center text-sm disabled:opacity-60"
                      >
                        {emoji}
                      </button>
                    ))}
                    <span className="w-px h-5 bg-white/20 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => startReply(m)}
                      aria-label="Reply"
                      title="Reply"
                      className="h-7 w-7 rounded-full hover:bg-white/[0.14] flex items-center justify-center text-white/85"
                    >
                      <ReplyIcon className="h-3.5 w-3.5" />
                    </button>
                    {canUseInternalNotes && (
                      <>
                        <span className="w-px h-5 bg-white/20 mx-0.5" />
                        <button
                          type="button"
                          onClick={() => toggleNoteDraft(m)}
                          aria-label="Add internal note"
                          title="Add internal note"
                          className="h-7 w-7 rounded-full hover:bg-white/[0.14] flex items-center justify-center text-white/85"
                        >
                          <LockIcon className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {m.reactions.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${mine ? "justify-end" : "justify-start"}`}>
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        onClick={() => toggleReaction(m.id, r.emoji)}
                        disabled={reactingId === m.id}
                        className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs disabled:opacity-60 ${
                          r.reactedByMe ? "bg-accent/15 border-accent" : "bg-black/[0.03] border-border hover:bg-black/[0.06]"
                        }`}
                      >
                        <span>{r.emoji}</span>
                        <span className="font-medium text-muted">{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}

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
                          onChange={(e) => setNoteDraftBody(e.target.value)}
                          placeholder="Note for staff only…"
                          rows={2}
                          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent resize-none"
                        />
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setNoteDraftId(null);
                              setNoteDraftBody("");
                            }}
                            className="text-xs text-muted hover:text-accent-ink"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => submitNote(m.id)}
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

                {m.id === lastMineId && otherLastReadAt && m.createdAt <= otherLastReadAt && (
                  <p className="text-[10px] text-muted mt-0.5">Seen</p>
                )}
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-border p-3 space-y-2">
        {attachedRef && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            style={{ background: "rgba(1,105,240,0.07)", borderColor: "rgba(1,105,240,0.25)" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-brand-ink" />
              <p className="text-xs truncate">
                Attached: <span className="font-semibold text-brand-ink">{formatRefDate(attachedRef.date)}</span> availability
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
        {replyingTo && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-black/[0.02] px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Replying to {replyingTo.senderId === viewerId ? "yourself" : replyingTo.senderName}
              </p>
              <p className="text-xs text-muted truncate">{previewText(replyingTo)}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="text-xs text-muted hover:text-accent-ink shrink-0"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="relative">
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
              setTimeout(() => setMentionTrigger(null), 150);
            }}
            placeholder="Text message…"
            rows={2}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent resize-none"
          />
        </div>
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
          <button type="submit" disabled={sending || (!body.trim() && !file)} className="btn-primary text-sm px-4 py-2 shrink-0">
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
