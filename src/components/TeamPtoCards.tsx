"use client";

import { useState, useEffect } from "react";
import PtoStatusPill from "@/components/PtoStatusPill";
import TeamNotesThread from "@/components/TeamNotesThread";
import { ChatIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import { toneForStatus } from "@/lib/status-tone";
import type { AdminPtoRequestDTO, AdminPtoSummaryDTO, TeamNoteTopicCountDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/** employeeId+requestId -> total message count, built from
 *  GET /api/admin/team-notes/topic-counts — same idea as TeamAvailabilityCards' countsByDate,
 *  just keyed on PTO_REQUEST rows (which have no topicDate) instead of AVAILABILITY_DATE. */
function countsByRequest(counts: TeamNoteTopicCountDTO[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of counts) {
    if (c.topicType !== "PTO_REQUEST") continue;
    map.set(`${c.employeeId}:${c.topicId}`, c.total);
  }
  return map;
}

/**
 * The HR-wide PTO dashboard's actual card list — fetch, Approve/Deny/Undo, Pending/Decided
 * sections, and a conversation scoped to each request — extracted from PtoAdminView (Sept
 * 2026) so it can be dropped straight onto the dashboard's own Availability widget page for
 * admins, not just the standalone /admin/pto page. Same reasoning as TeamAvailabilityCards:
 * one card implementation, reused in both places, rather than two copies to keep in sync.
 *
 * Round two (Sept 2026): a PTO request is already a single date range rather than several
 * independent dates, so unlike TeamAvailabilityCards there's nothing to split a conversation
 * across — tapping the card's one chip opens a single conversation scoped to that request
 * (TeamNotesThread's topicType="PTO_REQUEST"), the direct equivalent of "tap a date" for a
 * request that only ever has the one range.
 *
 * `viewerId` is the signed-in admin/supervisor viewing this list — see TeamAvailabilityCards
 * for why it's needed and why it plays no part in access control here.
 */
export default function TeamPtoCards({ viewerId }: { viewerId: string }) {
  const [summary, setSummary] = useState<AdminPtoSummaryDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [messageCounts, setMessageCounts] = useState<Map<string, number>>(new Map());

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/pto");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSummary(data);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  // Best-effort, same reasoning as TeamAvailabilityCards' loadCounts — a missing badge isn't
  // worth failing the whole card list over.
  async function loadCounts() {
    try {
      const res = await fetch("/api/admin/team-notes/topic-counts");
      if (!res.ok) return;
      const data: { counts: TeamNoteTopicCountDTO[] } = await res.json();
      setMessageCounts(countsByRequest(data.counts));
    } catch {
      // ignored — see comment above
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadCounts();
  }, []);

  async function decide(id: string, decision: "APPROVED" | "DENIED", comment?: string) {
    setBusyId(id);
    try {
      await fetch(`/api/pto/requests/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });
    } finally {
      setBusyId(null);
      setDenyingId(null);
      setDenyComment("");
      load();
    }
  }

  async function undo(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/pto/requests/${id}/undecide`, { method: "POST" });
    } finally {
      setBusyId(null);
      load();
    }
  }

  if (loadState === "loading") {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error" || !summary) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load PTO requests. Please try again or contact support.
      </div>
    );
  }

  return (
    <>
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Pending ({summary.pending.length})
        </h2>
        {summary.pending.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing pending right now.
          </div>
        ) : (
          <div className="space-y-3">
            {summary.pending.map((r) => (
              <Card
                key={r.id}
                row={r}
                viewerId={viewerId}
                busy={busyId === r.id}
                denying={denyingId === r.id}
                denyComment={denyComment}
                open={openId === r.id}
                messageCounts={messageCounts}
                onToggleOpen={() => setOpenId(openId === r.id ? null : r.id)}
                onDenyToggle={() => setDenyingId(denyingId === r.id ? null : r.id)}
                onDenyCommentChange={setDenyComment}
                onDecide={decide}
                onUndo={undo}
                onMessagePosted={loadCounts}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Decided ({summary.decided.length})
        </h2>
        {summary.decided.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing decided yet.
          </div>
        ) : (
          <div className="space-y-3">
            {summary.decided.map((r) => (
              <Card
                key={r.id}
                row={r}
                viewerId={viewerId}
                busy={busyId === r.id}
                denying={false}
                denyComment=""
                open={openId === r.id}
                messageCounts={messageCounts}
                onToggleOpen={() => setOpenId(openId === r.id ? null : r.id)}
                onDenyToggle={() => {}}
                onDenyCommentChange={() => {}}
                onDecide={() => {}}
                onUndo={undo}
                onMessagePosted={loadCounts}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Card({
  row: r,
  viewerId,
  busy,
  denying,
  denyComment,
  open,
  messageCounts,
  onToggleOpen,
  onDenyToggle,
  onDenyCommentChange,
  onDecide,
  onUndo,
  onMessagePosted,
}: {
  row: AdminPtoRequestDTO;
  viewerId: string;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  open: boolean;
  messageCounts: Map<string, number>;
  onToggleOpen: () => void;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (id: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
  onUndo: (id: string) => void;
  onMessagePosted: () => void;
}) {
  // CB, Sept 2026, round three: same status-driven tone as TeamAvailabilityCards now uses —
  // Approved is pink, Pending is amber/yellow — replacing the old per-leave-type coloring.
  const tone = toneForStatus(r.status);
  const isPending = r.status === "PENDING";
  const msgCount = messageCounts.get(`${r.employeeId}:${r.id}`) ?? 0;

  return (
    <div
      className="rounded-3xl shadow-lg overflow-hidden p-4 sm:p-5"
      style={{ background: `linear-gradient(150deg, ${tone.from} 0%, ${tone.to} 100%)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="h-10 w-10 rounded-full bg-white/25 border border-white/40 flex items-center justify-center text-sm font-semibold text-white shrink-0">
            {initialsOf(r.employeeName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-base font-semibold text-white truncate">{r.employeeName}</p>
              {r.employeeId === viewerId && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white bg-white/25 border border-white/40 rounded-full px-1.5 py-0.5">
                  You
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {isPending ? (
                <span className="text-xs font-medium text-white/80">Awaiting your decision</span>
              ) : (
                <>
                  <PtoStatusPill status={r.status} />
                  <button onClick={() => onUndo(r.id)} disabled={busy} className="text-xs font-medium text-white/85 hover:text-white underline underline-offset-2">
                    Undo
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <span className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center shrink-0" title="Tap below to message about this request">
          <ChatIcon className="h-4 w-4 text-white" />
        </span>
      </div>

      <button
        type="button"
        onClick={onToggleOpen}
        className={`relative mt-3.5 flex flex-col items-start rounded-xl px-2.5 py-1.5 leading-tight transition-colors ${
          open ? "bg-white" : "bg-white/15 hover:bg-white/25 border border-white/25"
        }`}
        style={open ? { color: tone.to } : undefined}
      >
        <span className={`text-xs font-semibold ${open ? "" : "text-white"}`}>{PTO_TYPE_LABEL[r.type]}</span>
        <span className={`text-[11px] ${open ? "opacity-70" : "text-white/80"}`}>
          {formatDateRange(r.startDate, r.endDate)} · {r.hours} hrs
        </span>
        {/* Same "read cleanly" reasoning as TeamAvailabilityCards' date chips — a request with
            a conversation on it says so at a glance, open or not. */}
        {msgCount > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold shadow-sm"
            style={{ color: tone.to }}
            title={`${msgCount} message${msgCount === 1 ? "" : "s"} on this request`}
          >
            <ChatIcon className="h-2.5 w-2.5" />
            {msgCount}
          </span>
        )}
      </button>

      {r.reason && <p className="text-sm text-white/85 italic mt-2.5">&ldquo;{r.reason}&rdquo;</p>}
      {!isPending && r.reviewComment && (
        <p className="text-sm text-white/85 italic mt-2">Reviewer note: &ldquo;{r.reviewComment}&rdquo;</p>
      )}

      {isPending && (
        <div className="flex items-center gap-2 mt-3.5">
          <button
            onClick={() => onDecide(r.id, "APPROVED")}
            disabled={busy}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:brightness-95 disabled:opacity-60"
            style={{ color: tone.to }}
          >
            Approve
          </button>
          <button
            onClick={onDenyToggle}
            disabled={busy}
            className="rounded-full bg-white/15 border border-white/35 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-60"
          >
            Deny
          </button>
        </div>
      )}

      {denying && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-white/15 rounded-xl p-3">
          <textarea
            value={denyComment}
            onChange={(e) => onDenyCommentChange(e.target.value)}
            placeholder="Optional note for the team member…"
            rows={2}
            className="flex-1 rounded-md border border-white/30 bg-white/90 px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white placeholder:text-muted"
          />
          <button
            onClick={() => onDecide(r.id, "DENIED", denyComment.trim() || undefined)}
            disabled={busy}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold self-start shadow-sm"
            style={{ color: tone.to }}
          >
            Confirm deny
          </button>
        </div>
      )}

      {open && (
        <div className="mt-3.5">
          <p className="text-xs font-semibold text-white/80 mb-1.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
            {PTO_TYPE_LABEL[r.type]} — conversation
          </p>
          <TeamNotesThread
            employeeId={r.employeeId}
            viewerId={viewerId}
            topicType="PTO_REQUEST"
            topicId={r.id}
            placeholder="Write a message about this request…"
            onMessagePosted={onMessagePosted}
          />
        </div>
      )}
    </div>
  );
}
