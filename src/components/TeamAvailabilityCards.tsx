"use client";

import { useState, useEffect } from "react";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import TeamNotesThread from "@/components/TeamNotesThread";
import { ChatIcon } from "@/components/icons";
import { slotChips } from "@/lib/availability-format";
import type { AdminAvailabilityDTO, TeamNoteTopicCountDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** Five bold card-background gradients, cycled by a hash of the person's name so a given
 *  person's card color is stable across a reload rather than reshuffling. Two of the five are
 *  TTC's own brand colors (pink, blue); the other three are Tailwind's amber/emerald/violet
 *  500→700 pairs, matching the hues already used elsewhere in this app (TeamPtoCards' old
 *  per-type chips, status pills) so nothing here introduces an off-brand color. CB (Sept 2026,
 *  round two of the card redesign), after seeing the first version's small colored chips on a
 *  white card: she wanted the bold, magazine-style color-per-card look of a reference sports
 *  app she shared, "complementary" rather than clashing — a full-card gradient plus
 *  same-hue-family translucent chips reads as one considered color per card instead of five
 *  different hues competing on one screen. */
const CARD_TONES = [
  { from: "var(--ttc-pink)", to: "var(--ttc-pink-ink)" },
  { from: "var(--ttc-blue)", to: "var(--ttc-blue-ink)" },
  { from: "#f59e0b", to: "#b45309" }, // amber-500 → amber-700
  { from: "#10b981", to: "#047857" }, // emerald-500 → emerald-700
  { from: "#8b5cf6", to: "#6d28d9" }, // violet-500 → violet-700
];

function toneForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CARD_TONES[hash % CARD_TONES.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/** employeeId+submissionId+date -> total message count, built from
 *  GET /api/admin/team-notes/topic-counts. Only AVAILABILITY_DATE rows matter here — TeamPtoCards
 *  builds its own map the same way, keyed on PTO_REQUEST rows instead. */
function countsByDate(counts: TeamNoteTopicCountDTO[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of counts) {
    if (c.topicType !== "AVAILABILITY_DATE") continue;
    map.set(`${c.employeeId}:${c.topicId}:${c.topicDate ?? ""}`, c.total);
  }
  return map;
}

/**
 * The HR-wide availability roster's actual card list — fetch, Approve/Deny/Undo,
 * Pending/Decided sections, and a per-date conversation on each card — extracted from
 * AvailabilityAdminView (Sept 2026) so it can be dropped straight onto the dashboard's own
 * Availability widget page for admins, not just the standalone /admin/availability page.
 *
 * Round two (Sept 2026): CB, on the first version — "I see approved... but each scheduled day
 * may have different requests. I wanted to make comments under each day that was selected."
 * Tapping the card header no longer opens one shared thread for the whole submission; tapping
 * a specific date chip opens a conversation scoped to just that date (TeamNotesThread's
 * topicType="AVAILABILITY_DATE"), since a four-date submission can need four different
 * conversations. At most one date is open per card at a time (`openDate`).
 *
 * `viewerId` is the signed-in admin/supervisor viewing this list — needed so every open thread
 * (see TeamNotesThread) knows which side of the conversation is "you." Not used for any access
 * decision here; the API routes each card talks to re-check authorization themselves.
 */
export default function TeamAvailabilityCards({ viewerId }: { viewerId: string }) {
  const [pending, setPending] = useState<AdminAvailabilityDTO[]>([]);
  const [decided, setDecided] = useState<AdminAvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");
  const [openDate, setOpenDate] = useState<{ submissionId: string; date: string } | null>(null);
  const [messageCounts, setMessageCounts] = useState<Map<string, number>>(new Map());

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/availability");
      if (!res.ok) throw new Error();
      const data: { pending: AdminAvailabilityDTO[]; decided: AdminAvailabilityDTO[] } = await res.json();
      setPending(data.pending);
      setDecided(data.decided);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  // Best-effort — a chip missing its message badge isn't worth failing the whole card list
  // over, so a failed fetch here just leaves counts empty instead of throwing.
  async function loadCounts() {
    try {
      const res = await fetch("/api/admin/team-notes/topic-counts");
      if (!res.ok) return;
      const data: { counts: TeamNoteTopicCountDTO[] } = await res.json();
      setMessageCounts(countsByDate(data.counts));
    } catch {
      // ignored — see comment above
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadCounts();
  }, []);

  async function decide(submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) {
    setBusyId(submissionId);
    try {
      await fetch(`/api/availability/${submissionId}/decide`, {
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

  async function undo(submissionId: string) {
    setBusyId(submissionId);
    try {
      await fetch(`/api/availability/${submissionId}/undecide`, { method: "POST" });
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

  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load availability. Please try again or contact support.
      </div>
    );
  }

  return (
    <>
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing pending right now.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <Card
                key={r.id}
                row={r}
                viewerId={viewerId}
                busy={busyId === r.id}
                denying={denyingId === r.id}
                denyComment={denyComment}
                openDate={openDate?.submissionId === r.id ? openDate.date : null}
                messageCounts={messageCounts}
                onToggleDate={(date) =>
                  setOpenDate(openDate?.submissionId === r.id && openDate.date === date ? null : { submissionId: r.id, date })
                }
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
          Decided ({decided.length})
        </h2>
        {decided.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing decided yet.
          </div>
        ) : (
          <div className="space-y-3">
            {decided.map((r) => (
              <Card
                key={r.id}
                row={r}
                viewerId={viewerId}
                busy={busyId === r.id}
                denying={false}
                denyComment=""
                openDate={openDate?.submissionId === r.id ? openDate.date : null}
                messageCounts={messageCounts}
                onToggleDate={(date) =>
                  setOpenDate(openDate?.submissionId === r.id && openDate.date === date ? null : { submissionId: r.id, date })
                }
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
  openDate,
  messageCounts,
  onToggleDate,
  onDenyToggle,
  onDenyCommentChange,
  onDecide,
  onUndo,
  onMessagePosted,
}: {
  row: AdminAvailabilityDTO;
  viewerId: string;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  openDate: string | null;
  messageCounts: Map<string, number>;
  onToggleDate: (date: string) => void;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
  onUndo: (submissionId: string) => void;
  onMessagePosted: () => void;
}) {
  const chips = slotChips(r.slots);
  const tone = toneForName(r.employeeName);
  const isPending = r.status === "PENDING";
  const openChip = chips.find((c) => c.date === openDate);

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
            <p className="text-base font-semibold text-white truncate">{r.employeeName}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {isPending ? (
                <span className="text-xs font-medium text-white/80">Awaiting your decision</span>
              ) : (
                <>
                  <AvailabilityStatusPill status={r.status} />
                  <button onClick={() => onUndo(r.id)} disabled={busy} className="text-xs font-medium text-white/85 hover:text-white underline underline-offset-2">
                    Undo
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <span className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center shrink-0" title="Tap a date below to message about it">
          <ChatIcon className="h-4 w-4 text-white" />
        </span>
      </div>

      {chips.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const active = c.date === openDate;
            const msgCount = messageCounts.get(`${r.employeeId}:${r.id}:${c.date}`) ?? 0;
            return (
              <button
                key={c.date}
                type="button"
                onClick={() => onToggleDate(c.date)}
                className={`relative flex flex-col items-start rounded-xl px-2.5 py-1.5 leading-tight transition-colors ${
                  active ? "bg-white" : "bg-white/15 hover:bg-white/25 border border-white/25"
                }`}
                style={active ? { color: tone.to } : undefined}
              >
                <span className={`text-xs font-semibold ${active ? "" : "text-white"}`}>{c.dateLabel}</span>
                <span className={`text-[11px] ${active ? "opacity-70" : "text-white/80"}`}>{c.timeLabel}</span>
                {/* CB, Sept 2026: "I don't see where Sean could see those messages... it needs
                    to read cleanly" — every chip that has a conversation on it says so, whether
                    the chip is open or not, so a glance at the card shows which dates actually
                    have activity instead of every chip looking the same until you click it. */}
                {msgCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold shadow-sm"
                    style={{ color: tone.to }}
                    title={`${msgCount} message${msgCount === 1 ? "" : "s"} on this date`}
                  >
                    <ChatIcon className="h-2.5 w-2.5" />
                    {msgCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-white/80 mt-2">No dates marked available.</p>
      )}

      {r.note && <p className="text-sm text-white/85 italic mt-2.5">&ldquo;{r.note}&rdquo;</p>}
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

      {openChip && (
        <div className="mt-3.5">
          <p className="text-xs font-semibold text-white/80 mb-1.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
            {openChip.dateLabel} — conversation
          </p>
          <TeamNotesThread
            employeeId={r.employeeId}
            viewerId={viewerId}
            topicType="AVAILABILITY_DATE"
            topicId={r.id}
            topicDate={openChip.date}
            placeholder="Write a message about this date…"
            onMessagePosted={onMessagePosted}
          />
        </div>
      )}
    </div>
  );
}
