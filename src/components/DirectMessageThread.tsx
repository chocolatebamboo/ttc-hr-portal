"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon, ChecklistIcon } from "@/components/icons";
import { QUICK_REACTION_EMOJIS } from "@/types";
import type { DirectMessageDTO, DirectMessageThreadDTO } from "@/types";

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
 */
export default function DirectMessageThread({
  otherEmployeeId,
  viewerId,
  onMessagePosted,
  onRead,
}: {
  otherEmployeeId: string;
  viewerId: string;
  /** Fires after a message is successfully sent — lets the inbox list above refresh its
   *  conversation summary (last message, counts) without waiting for the next full page load. */
  onMessagePosted?: () => void;
  /** Fires after this thread's messages successfully load — the moment listMessages marks it
   *  read for the viewer server-side (see its own comment in src/lib/direct-messages.ts). Same
   *  reasoning as TeamNotesThread's own onRead. */
  onRead?: () => void;
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
  // Which message has a reaction toggle in flight — just disables that message's own pills/
  // picker while it's happening, same narrow busy-scoping every other list in this app uses.
  const [reactingId, setReactingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

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

      const res = await fetch(`/api/messages/dm/${otherEmployeeId}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error ?? "Couldn't send that. Please try again.");
        return;
      }
      setBody("");
      setFile(null);
      setReplyingTo(null);
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

  // The last message the viewer themselves sent — the one and only bubble a "Seen" mark can ever
  // appear under, same as a normal texting app never stamping every message with its own receipt.
  const lastMineId = [...messages].reverse().find((m) => m.senderId === viewerId)?.id ?? null;

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="p-4 space-y-3 max-h-[28rem] overflow-y-auto">
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
                {/* CB, Sept 2026: "I should be able to kind of like reference within the
                    conversation of my message with a specific team member" — a message that
                    mirrored over from a task's own comment thread (addDateTaskComment, src/lib/
                    date-tasks.ts) carries a small reference card above the bubble, same idea as
                    a reply preview in a normal texting app: what this was actually about, and
                    when. Sits outside the colored bubble (plain surface either way) so it reads
                    the same regardless of which side sent it. */}
                {m.ref && (
                  <div className="max-w-[80%] mb-1 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      <ChecklistIcon className="h-3 w-3" />
                      Task{m.ref.date ? ` · ${formatRefDate(m.ref.date)}` : ""}
                    </div>
                    <p className="text-xs font-semibold mt-0.5">{m.ref.label}</p>
                  </div>
                )}
                {/* CB, Sept 2026: "I should be able to reply to a specific message within the
                    message thread" — the quoted-preview card a reply renders above itself,
                    pointing back at whichever message it was answering. Same plain-surface
                    styling as the task reference card above, just quoting a message instead of
                    an external record. */}
                {m.replyTo && (
                  <div className="max-w-[80%] mb-1 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {m.replyTo.senderId === viewerId ? "You" : m.replyTo.senderName}
                    </p>
                    <p className="text-xs text-muted truncate">{previewText(m.replyTo)}</p>
                  </div>
                )}
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
                  {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
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

                {/* Quick-reaction pills — CB, Sept 2026: "I should have the options to include
                    emojis to react to other people's replies." Tap-to-toggle: tapping a pill
                    you've already reacted with removes it (toggleReaction's own doc comment in
                    src/lib/direct-messages.ts). Only ever shows emoji actually in use, never all
                    six as placeholders. */}
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

                {/* The react/reply action row — opened by tapping the bubble itself, closed again
                    the moment either action fires. */}
                {activeMessageId === m.id && (
                  <div className={`flex items-center gap-1 mt-1.5 ${mine ? "justify-end" : "justify-start"}`}>
                    {QUICK_REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleReaction(m.id, emoji)}
                        disabled={reactingId === m.id}
                        className="h-7 w-7 rounded-full bg-black/[0.04] hover:bg-black/[0.08] flex items-center justify-center text-sm disabled:opacity-60"
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => startReply(m)}
                      className="h-7 px-2.5 rounded-full bg-black/[0.04] hover:bg-black/[0.08] text-xs font-medium text-muted"
                    >
                      Reply
                    </button>
                  </div>
                )}

                {/* CB, Sept 2026: "I should be able to see also when they read the message on
                    their side" — an iMessage-style "Seen" mark under the last message the viewer
                    sent, once the other person's own lastReadAt for this thread covers it. Never
                    stamped on every message, only the most recent one of the viewer's own. */}
                {m.id === lastMineId && otherLastReadAt && m.createdAt <= otherLastReadAt && (
                  <p className="text-[10px] text-muted mt-0.5">Seen</p>
                )}
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-border p-3 space-y-2">
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
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Text message…"
          rows={2}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent resize-none"
        />
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
