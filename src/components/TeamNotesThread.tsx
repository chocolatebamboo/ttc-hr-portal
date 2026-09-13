"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "@/components/icons";
import type { TeamNoteDTO, TeamNoteTopicType } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** "Sep 9, 3:45 PM" — same short-date-plus-time-of-day pairing formatSlotDate/formatClockTime
 *  already use separately elsewhere, just combined for a single message timestamp. */
function formatNoteTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

function topicQuery(topicType?: TeamNoteTopicType, topicId?: string, topicDate?: string): string {
  if (!topicType || !topicId) return "";
  const params = new URLSearchParams({ topicType, topicId });
  if (topicDate) params.set("topicDate", topicDate);
  return `?${params.toString()}`;
}

/**
 * CB, Sept 2026: "a texting feature to where we would be able to communicate back and forth...
 * add notes, add documents." One thread per team member — used on the employee's own /notes
 * page, on /team/[employeeId], and (with `topicType`/`topicId`/`topicDate` set) as a narrower
 * conversation scoped to one specific availability date, PTO request, or (Phase 3, client spec,
 * Sept 2026) confirmed shift on the admin card / schedule views. Access is enforced
 * server-side by src/lib/team-notes.ts either way (self, that employee's supervisor, or an
 * admin; backed up independently by prisma/rls.sql's team_note_select/team_note_write).
 * `viewerId` decides which side of the chat a given message renders on — it's never used for
 * access control, only left/right alignment.
 *
 * Omit the topic props entirely for the general thread. When set, they must describe exactly
 * one topic (an availability date needs topicDate too; a PTO request or shift never does) — see
 * TeamNoteTopic in src/lib/team-notes.ts.
 */
export default function TeamNotesThread({
  employeeId,
  viewerId,
  topicType,
  topicId,
  topicDate,
  placeholder = "Write a message…",
  onMessagePosted,
}: {
  employeeId: string;
  viewerId: string;
  topicType?: TeamNoteTopicType;
  topicId?: string;
  topicDate?: string;
  placeholder?: string;
  /** Fires after a message is successfully posted in this thread — lets a parent that shows a
   *  message-count badge for this same topic (TeamAvailabilityCards, TeamPtoCards,
   *  AvailabilityCalendar, TimesheetView) refresh its count right away instead of waiting for
   *  the next full page load. */
  onMessagePosted?: () => void;
}) {
  const [notes, setNotes] = useState<TeamNoteDTO[]>([]);
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
      const res = await fetch(`/api/team-notes/${employeeId}${topicQuery(topicType, topicId, topicDate)}`);
      if (!res.ok) throw new Error();
      const data: { notes: TeamNoteDTO[] } = await res.json();
      setNotes(data.notes);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, topicType, topicId, topicDate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [notes.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && !file) return;

    setSending(true);
    setSendError("");
    try {
      const form = new FormData();
      form.set("body", body);
      if (file) form.set("file", file);
      if (topicType && topicId) {
        form.set("topicType", topicType);
        form.set("topicId", topicId);
        if (topicDate) form.set("topicDate", topicDate);
      }

      const res = await fetch(`/api/team-notes/${employeeId}`, { method: "POST", body: form });
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

  async function handleDownload(noteId: string) {
    setDownloadingId(noteId);
    try {
      const res = await fetch(`/api/team-notes/${employeeId}/${noteId}/download`);
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
          <div className="text-sm text-accent">Unable to load this thread. Please try again or contact support.</div>
        )}

        {loadState === "ready" && notes.length === 0 && (
          <div className="text-sm text-muted">No messages yet — say hello.</div>
        )}

        {loadState === "ready" &&
          notes.map((n) => {
            const mine = n.authorId === viewerId;
            return (
              <div key={n.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${mine ? "text-white" : "bg-black/[0.04]"}`} style={mine ? { background: "var(--ttc-blue)" } : undefined}>
                  {!mine && <p className="text-xs font-semibold mb-0.5">{n.authorName}</p>}
                  {n.body && <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>}
                  {n.hasAttachment && (
                    <button
                      onClick={() => handleDownload(n.id)}
                      disabled={downloadingId === n.id}
                      className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium underline ${mine ? "text-white/90" : "text-accent-ink"}`}
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                      {n.attachmentName ?? "Attachment"}
                    </button>
                  )}
                  <p className={`text-[11px] mt-1 ${mine ? "text-white/70" : "text-muted"}`}>{formatNoteTime(n.createdAt)}</p>
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
          placeholder={placeholder}
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
              <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-xs text-muted hover:text-accent-ink shrink-0">
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
