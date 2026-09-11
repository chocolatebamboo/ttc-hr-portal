"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "@/components/icons";
import type { DirectMessageDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** "Sep 9, 3:45 PM" — same shape formatNoteTime uses in TeamNotesThread. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
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
 */
export default function DirectMessageThread({
  otherEmployeeId,
  viewerId,
  onMessagePosted,
}: {
  otherEmployeeId: string;
  viewerId: string;
  /** Fires after a message is successfully sent — lets the inbox list above refresh its
   *  conversation summary (last message, counts) without waiting for the next full page load. */
  onMessagePosted?: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessageDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/messages/dm/${otherEmployeeId}`);
      if (!res.ok) throw new Error();
      const data: { messages: DirectMessageDTO[] } = await res.json();
      setMessages(data.messages);
      setLoadState("ready");
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

      const res = await fetch(`/api/messages/dm/${otherEmployeeId}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error ?? "Couldn't send that. Please try again.");
        return;
      }
      setBody("");
      setFile(null);
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
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${mine ? "text-white" : "bg-black/[0.04]"}`}
                  style={mine ? { background: "var(--ttc-blue)" } : undefined}
                >
                  {!mine && <p className="text-xs font-semibold mb-0.5">{m.senderName}</p>}
                  {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                  {m.hasAttachment && (
                    <button
                      onClick={() => handleDownload(m.id)}
                      disabled={downloadingId === m.id}
                      className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium underline ${mine ? "text-white/90" : "text-accent-ink"}`}
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                      {m.attachmentName ?? "Attachment"}
                    </button>
                  )}
                  <p className={`text-[11px] mt-1 ${mine ? "text-white/70" : "text-muted"}`}>{formatMessageTime(m.createdAt)}</p>
                </div>
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-border p-3 space-y-2">
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
