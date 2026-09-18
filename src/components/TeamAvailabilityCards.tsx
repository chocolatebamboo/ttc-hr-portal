"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import DateTasksPanel from "@/components/DateTasksPanel";
import SwipeReveal from "@/components/SwipeReveal";
import { ChecklistIcon, CheckCircleIcon, CalendarIcon, TrashIcon, ChatIcon } from "@/components/icons";
import { slotChips } from "@/lib/availability-format";
import { toneForStatus, YOU_TONE } from "@/lib/status-tone";
import type { AdminAvailabilityDTO, AdminShiftDTO, AvailabilitySlot } from "@/types";

type LoadState = "loading" | "ready" | "error";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * The HR-wide availability roster's actual card list — fetch, Approve/Deny/Undo,
 * Pending/Decided sections, and a per-date task list on each card — extracted from
 * AvailabilityAdminView (Sept 2026) so it can be dropped straight onto the dashboard's own
 * Availability widget page for admins, not just the standalone /admin/availability page.
 *
 * Round two (Sept 2026): CB, on the first version — "I see approved... but each scheduled day
 * may have different requests. I wanted to make comments under each day that was selected."
 * Tapping the card header no longer opens one shared thread for the whole submission; tapping
 * a specific date chip opens that date's own task list (DateTasksPanel), since a four-date
 * submission can need four different sets of tasks. At most one date is open per card at a time
 * (`openDate`).
 *
 * Correction brief #2 (Sept 2026): "Remove the large standalone 'Conversation' section currently
 * underneath the tasks... Communication should instead be contextual to each task." The
 * per-date TeamNotesThread that used to sit below DateTasksPanel here (topicType=
 * "AVAILABILITY_DATE") — and the per-chip message-count badge that existed only to flag activity
 * in that now-removed thread — are both gone; every task opened via DateTasksPanel now carries
 * its own comment thread instead (see DateTaskRow).
 *
 * `viewerId` is the signed-in admin/supervisor viewing this list — passed down to DateTasksPanel
 * so its own task rows know which side of a comment they're rendering. Not used for any access
 * decision here; the API routes each card talks to re-check authorization themselves.
 *
 * Correction brief #10 (Sept 2026): every card here — Pending or Decided — now also swipes to
 * reveal an administrative "Remove" action, distinct from Deny (see removeSubmission below and
 * removeAvailabilitySubmission's own comment in src/lib/availability.ts for exactly how). A
 * Decided card's swipe therefore reveals two actions side by side: "Clear" (Correction brief #9's
 * local dismiss, unchanged) and "Remove" (this round's real, permanent removal) — SwipeReveal's
 * new secondaryAction prop makes that one swipe instead of two different gestures.
 *
 * Correction brief #11 (Sept 2026): "The chat bubble on an availability request should take the
 * user into My Messages... open the relevant conversation/thread for that specific team member/
 * request rather than only opening the generic Messages landing page." This is a direct message,
 * not a revival of the old AVAILABILITY_DATE topic thread Correction brief #2 already removed
 * from this card — per-request communication now lives on each task's own comment thread
 * (DateTaskRow), so "message this team member about their availability" means the same
 * peer-to-peer DM every other person-to-person conversation in this app uses
 * (src/lib/direct-messages.ts). One bubble per card, not per date, since a DM isn't scoped to a
 * single date the way a task is. See openChat below and MessagesInboxView's own doc comment for
 * the other half of this (reading `dm`/`name` off the URL on mount).
 */
export default function TeamAvailabilityCards({ viewerId }: { viewerId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<AdminAvailabilityDTO[]>([]);
  const [decided, setDecided] = useState<AdminAvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");
  const [openDate, setOpenDate] = useState<{ submissionId: string; date: string } | null>(null);
  // Phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): whether a given
  // date-chip on an APPROVED card has already been converted into a real confirmed Shift —
  // "Scheduling" is a deliberate second step after "Approve," not something Approve does by
  // itself (see Shift's own doc comment in prisma/schema.prisma). Keyed "submissionId:date".
  const [shiftsByDate, setShiftsByDate] = useState<Map<string, AdminShiftDTO>>(new Map());
  const [convertingDate, setConvertingDate] = useState<string | null>(null);
  // CB, Sept 2026: "[approve/deny] with no way to close out afterward" — once a card has been
  // decided, swiping it away clears it from view, same SwipeReveal "Clear" pattern Messages
  // uses (CheckCircleIcon). Correction brief #9 (this round): dismissal is now real server state
  // (src/lib/dashboard-dismissals.ts + /api/admin/availability/[id]/dismiss), not client-only —
  // the server's own listAdminAvailability already excludes dismissed rows from `decided`, so
  // this component doesn't track dismissal state itself; a swipe removes the row locally for an
  // instant response, then persists it in the background. A fresh decision (even re-approving
  // the same submission after Undo) always reappears — see decidedDismissalKey's own comment.
  // Only ever applies to Decided cards: a Pending one still needs an actual Approve/Deny, not a
  // way to make it disappear unactioned.

  // Correction brief #10 (Sept 2026): which card (if any) has its "Remove this availability
  // request?" confirmation open — tapping the swipe-revealed Remove button on either a Pending
  // or Decided card sets this rather than removing immediately, same two-step shape Deny already
  // uses (denyingId opens a confirm block; the actual decide only fires from a second, explicit
  // tap) — see this component's own doc comment above for why "swipe, then a second tap, then a
  // typed confirmation" is deliberate here, not accidental extra friction.
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Mirrors LoggedHoursSection.tsx's deleteError/deleteErrorEntryId pair — an error shown inline
  // on the one card it belongs to, not a page-wide banner, and cleared the moment a new attempt
  // (on any card) starts.
  const [removeError, setRemoveError] = useState<string | undefined>();
  const [removeErrorId, setRemoveErrorId] = useState<string | null>(null);
  // Correction brief #11 (Sept 2026): DM total/unread per team member, keyed by employeeId — the
  // chat bubble's own badge, same /api/messages/conversations the unified My Messages inbox uses
  // for its own DM rows. Best-effort like shiftsByDate below: a missing badge isn't worth failing
  // the card list over.
  const [dmCounts, setDmCounts] = useState<Map<string, { total: number; unread: number }>>(new Map());

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

  // Best-effort, same fire-and-forget convention DashboardNotifications.tsx's dismissBanner
  // uses — the local removal above already gives the admin their instant response; worst case
  // this POST fails silently and the card reappears the next time this list reloads.
  async function dismissDecided(submissionId: string) {
    try {
      await fetch(`/api/admin/availability/${submissionId}/dismiss`, { method: "POST" });
    } catch {
      // ignored — see comment above
    }
  }

  // Correction brief #10 (Sept 2026): the actual removal, only ever called from the "Remove
  // request" button inside the confirmation block below — never from the swipe action itself.
  // Unlike dismissDecided's fire-and-forget, this is a real, permanent change the admin is
  // waiting on, so it's awaited properly and surfaces a real error inline (via removeError/
  // removeErrorId) rather than swallowing a failure silently.
  async function removeSubmission(submissionId: string) {
    setBusyId(submissionId);
    setRemoveError(undefined);
    setRemoveErrorId(null);
    try {
      const res = await fetch(`/api/availability/${submissionId}/remove`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRemoveError(data.error ?? "Unable to remove this request. Please try again.");
        setRemoveErrorId(submissionId);
        return;
      }
      setRemovingId(null);
      load();
    } catch {
      setRemoveError("Unable to reach the server. Check your connection and try again.");
      setRemoveErrorId(submissionId);
    } finally {
      setBusyId(null);
    }
  }

  function cancelRemove() {
    setRemovingId(null);
    setRemoveError(undefined);
    setRemoveErrorId(null);
  }

  // Best-effort — a chip missing its "already scheduled" badge isn't worth failing the card
  // list over, so a failed fetch here just leaves it empty instead of throwing.
  async function loadShifts() {
    try {
      const res = await fetch("/api/admin/shifts");
      if (!res.ok) return;
      const data: { shifts: AdminShiftDTO[] } = await res.json();
      const map = new Map<string, AdminShiftDTO>();
      for (const s of data.shifts) {
        if (s.sourceAvailabilitySubmissionId && s.status !== "CANCELLED") {
          map.set(`${s.sourceAvailabilitySubmissionId}:${s.date}`, s);
        }
      }
      setShiftsByDate(map);
    } catch {
      // ignored — see comment above
    }
  }

  // Best-effort — same reasoning as loadShifts above, a missing DM badge isn't worth failing the
  // card list over.
  async function loadDmCounts() {
    try {
      const res = await fetch("/api/messages/conversations");
      if (!res.ok) return;
      const data: { conversations: { employeeId: string; total: number; unread: number }[] } = await res.json();
      const map = new Map<string, { total: number; unread: number }>();
      for (const c of data.conversations) map.set(c.employeeId, { total: c.total, unread: c.unread });
      setDmCounts(map);
    } catch {
      // ignored — see comment above
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadShifts();
    loadDmCounts();
  }, []);

  // Correction brief #11 (Sept 2026): navigates to the unified My Messages inbox with this team
  // member's DM conversation pre-opened. `employeeName` only seeds the row's label for a
  // conversation that doesn't exist yet — once real messages exist, the fetched
  // DirectConversationSummaryDTO's own employeeName takes over, same as NewMessagePicker's flow.
  function openChat(employeeId: string, employeeName: string) {
    router.push(`/messages?dm=${employeeId}&name=${encodeURIComponent(employeeName)}`);
  }

  async function convertToShift(submissionId: string, date: string) {
    setConvertingDate(`${submissionId}:${date}`);
    try {
      await fetch(`/api/admin/availability/${submissionId}/convert-to-shift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
    } finally {
      setConvertingDate(null);
      loadShifts();
    }
  }

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

  // Phase 2 (client spec, Sept 2026): the reviewer's third option besides Approve/Deny —
  // "Adjust the proposed time and send it to the team member for confirmation."
  async function requestAdjustment(submissionId: string, adjustedSlots: AvailabilitySlot[], comment?: string) {
    setBusyId(submissionId);
    try {
      await fetch(`/api/availability/${submissionId}/request-adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustedSlots, comment }),
      });
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
              <SwipeReveal
                key={r.id}
                actionSide="right"
                actionLabel="Remove"
                actionIcon={<TrashIcon className="h-4 w-4" />}
                actionClassName="bg-rose-600 text-white rounded-3xl"
                onAction={() => setRemovingId(r.id)}
              >
                <Card
                  row={r}
                  viewerId={viewerId}
                  busy={busyId === r.id}
                  denying={denyingId === r.id}
                  denyComment={denyComment}
                  removing={removingId === r.id}
                  removeError={removeErrorId === r.id ? removeError : undefined}
                  openDate={openDate?.submissionId === r.id ? openDate.date : null}
                  shiftsByDate={shiftsByDate}
                  convertingDate={convertingDate}
                  dmCounts={dmCounts}
                  onToggleDate={(date) =>
                    setOpenDate(openDate?.submissionId === r.id && openDate.date === date ? null : { submissionId: r.id, date })
                  }
                  onDenyToggle={() => setDenyingId(denyingId === r.id ? null : r.id)}
                  onDenyCommentChange={setDenyComment}
                  onDecide={decide}
                  onUndo={undo}
                  onConvertToShift={convertToShift}
                  onRequestAdjustment={requestAdjustment}
                  onRemoveConfirm={removeSubmission}
                  onRemoveCancel={cancelRemove}
                  onOpenChat={openChat}
                />
              </SwipeReveal>
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
              <SwipeReveal
                key={r.id}
                actionSide="right"
                actionLabel="Clear"
                actionIcon={<CheckCircleIcon className="h-4 w-4" />}
                actionClassName="bg-black/[0.06] text-accent-ink rounded-3xl"
                onAction={() => {
                  setDecided((prev) => prev.filter((x) => x.id !== r.id));
                  dismissDecided(r.id);
                }}
                secondaryAction={{
                  label: "Remove",
                  icon: <TrashIcon className="h-4 w-4" />,
                  className: "bg-rose-600 text-white rounded-3xl",
                  onAction: () => setRemovingId(r.id),
                }}
              >
                <Card
                  row={r}
                  viewerId={viewerId}
                  busy={busyId === r.id}
                  denying={false}
                  denyComment=""
                  removing={removingId === r.id}
                  removeError={removeErrorId === r.id ? removeError : undefined}
                  openDate={openDate?.submissionId === r.id ? openDate.date : null}
                  shiftsByDate={shiftsByDate}
                  convertingDate={convertingDate}
                  dmCounts={dmCounts}
                  onToggleDate={(date) =>
                    setOpenDate(openDate?.submissionId === r.id && openDate.date === date ? null : { submissionId: r.id, date })
                  }
                  onDenyToggle={() => {}}
                  onDenyCommentChange={() => {}}
                  onDecide={() => {}}
                  onUndo={undo}
                  onConvertToShift={convertToShift}
                  onRequestAdjustment={() => {}}
                  onRemoveConfirm={removeSubmission}
                  onRemoveCancel={cancelRemove}
                  onOpenChat={openChat}
                />
              </SwipeReveal>
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
  removing,
  removeError,
  openDate,
  shiftsByDate,
  convertingDate,
  dmCounts,
  onToggleDate,
  onDenyToggle,
  onDenyCommentChange,
  onDecide,
  onUndo,
  onConvertToShift,
  onRequestAdjustment,
  onRemoveConfirm,
  onRemoveCancel,
  onOpenChat,
}: {
  row: AdminAvailabilityDTO;
  viewerId: string;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  removing: boolean;
  removeError?: string;
  openDate: string | null;
  shiftsByDate: Map<string, AdminShiftDTO>;
  convertingDate: string | null;
  dmCounts: Map<string, { total: number; unread: number }>;
  onToggleDate: (date: string) => void;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
  onUndo: (submissionId: string) => void;
  onConvertToShift: (submissionId: string, date: string) => void;
  onRequestAdjustment: (submissionId: string, adjustedSlots: AvailabilitySlot[], comment?: string) => void;
  onRemoveConfirm: (submissionId: string) => void;
  onRemoveCancel: () => void;
  onOpenChat: (employeeId: string, employeeName: string) => void;
}) {
  const chips = slotChips(r.slots);
  // Phase 2 (client spec, Sept 2026): local-only state for the "Adjust the proposed time"
  // editor — one editable start/end time per date, seeded from the original submission's own
  // slots the moment the form opens, so the reviewer is tweaking real starting values rather
  // than typing every field from scratch.
  const [adjusting, setAdjusting] = useState(false);
  const [adjustTimes, setAdjustTimes] = useState<Record<string, { startTime: string; endTime: string }>>({});
  const [adjustComment, setAdjustComment] = useState("");
  // CB, Sept 2026, round three: "instead of the yellow background, I want the pink
  // background" (Approved) / "I think the pending color should be that yellow as well" —
  // confirmed this replaces the old per-employee tone entirely: color now signals the
  // decision itself (Pending/Approved/Denied), same everywhere, not who or what it's about.
  // CB, round five: the viewer's own card always reads in brand blue, regardless of status —
  // see YOU_TONE's doc comment in src/lib/status-tone.ts.
  const isSelf = r.employeeId === viewerId;
  const tone = isSelf ? YOU_TONE : toneForStatus(r.status);
  const isPending = r.status === "PENDING";
  const openChip = chips.find((c) => c.date === openDate);
  // Correction brief #10 (Sept 2026): "if an already-approved availability request has
  // generated or affected an actual schedule, handle the schedule relationship explicitly" —
  // this doesn't change whether Remove is allowed (removeAvailabilitySubmission never touches
  // the Shift table either way), just whether the confirmation below says so, so the admin isn't
  // surprised later. shiftsByDate is the same admin-wide map the "Scheduled as a shift" section
  // further down already uses, keyed "submissionId:date".
  const hasLinkedShift = chips.some((c) => shiftsByDate.has(`${r.id}:${c.date}`));
  // Correction brief #11 (Sept 2026): the chat bubble's own unread badge — see this component's
  // top-level doc comment for why this is a DM count, not a topic-thread count.
  const dmCount = dmCounts.get(r.employeeId);

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
              {isSelf && (
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
                  <AvailabilityStatusPill status={r.status} />
                  <button onClick={() => onUndo(r.id)} disabled={busy} className="text-xs font-medium text-white/85 hover:text-white underline underline-offset-2">
                    Undo
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Correction brief #11 (Sept 2026): "The chat bubble on an availability request
              should take the user into My Messages... open the relevant conversation/thread for
              that specific team member." Not shown on the viewer's own card — messaging yourself
              isn't a real conversation. */}
          {!isSelf && (
            <button
              type="button"
              onClick={() => onOpenChat(r.employeeId, r.employeeName)}
              className="relative h-8 w-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
              title={`Message ${r.employeeName}`}
            >
              <ChatIcon className="h-4 w-4 text-white" />
              {!!dmCount?.unread && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                  style={{ background: "#8b5cf6" }}
                >
                  {dmCount.unread > 9 ? "9+" : dmCount.unread}
                </span>
              )}
            </button>
          )}
          <span className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center" title="Tap a date below to see its tasks">
            <ChecklistIcon className="h-4 w-4 text-white" />
          </span>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const active = c.date === openDate;
            return (
              <button
                key={c.date}
                type="button"
                onClick={() => onToggleDate(c.date)}
                className={`flex flex-col items-start rounded-xl px-2.5 py-1.5 leading-tight transition-colors ${
                  active ? "bg-white" : "bg-white/15 hover:bg-white/25 border border-white/25"
                }`}
                style={active ? { color: tone.to } : undefined}
              >
                <span className={`text-xs font-semibold ${active ? "" : "text-white"}`}>{c.dateLabel}</span>
                <span className={`text-[11px] ${active ? "opacity-70" : "text-white/80"}`}>{c.timeLabel}</span>
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
        <div className="flex items-center gap-2 mt-3.5 flex-wrap">
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
          {/* Phase 2 (client spec, Sept 2026): "Adjust the proposed time and send it to the team
              member for confirmation" — a third decision besides Approve/Deny. */}
          <button
            onClick={() => {
              if (!adjusting) {
                const seeded: Record<string, { startTime: string; endTime: string }> = {};
                for (const slot of r.slots) seeded[slot.date] = { startTime: slot.startTime, endTime: slot.endTime };
                setAdjustTimes(seeded);
              }
              setAdjusting((v) => !v);
            }}
            disabled={busy}
            className="rounded-full bg-white/15 border border-white/35 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-60"
          >
            Adjust time
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

      {adjusting && (
        <div className="mt-3 flex flex-col gap-2.5 bg-white/15 rounded-xl p-3">
          {slotChips(r.slots).map((c) => (
            <div key={c.date} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-white min-w-[6.5rem]">{c.dateLabel}</span>
              <input
                type="time"
                value={adjustTimes[c.date]?.startTime ?? ""}
                onChange={(e) =>
                  setAdjustTimes((prev) => ({ ...prev, [c.date]: { ...prev[c.date], startTime: e.target.value } }))
                }
                className="rounded-md border border-white/30 bg-white/90 px-2 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-white"
              />
              <span className="text-xs text-white/80">to</span>
              <input
                type="time"
                value={adjustTimes[c.date]?.endTime ?? ""}
                onChange={(e) =>
                  setAdjustTimes((prev) => ({ ...prev, [c.date]: { ...prev[c.date], endTime: e.target.value } }))
                }
                className="rounded-md border border-white/30 bg-white/90 px-2 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-white"
              />
            </div>
          ))}
          <textarea
            value={adjustComment}
            onChange={(e) => setAdjustComment(e.target.value)}
            placeholder="Optional note explaining the change…"
            rows={2}
            className="rounded-md border border-white/30 bg-white/90 px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white placeholder:text-muted"
          />
          <button
            onClick={() => {
              const adjustedSlots: AvailabilitySlot[] = r.slots.map((slot) => ({
                date: slot.date,
                startTime: adjustTimes[slot.date]?.startTime ?? slot.startTime,
                endTime: adjustTimes[slot.date]?.endTime ?? slot.endTime,
              }));
              onRequestAdjustment(r.id, adjustedSlots, adjustComment.trim() || undefined);
              setAdjusting(false);
              setAdjustComment("");
            }}
            disabled={busy}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold self-start shadow-sm"
            style={{ color: tone.to }}
          >
            Send to team member
          </button>
        </div>
      )}

      {/* Correction brief #10 (Sept 2026): the confirmation the brief explicitly asks for —
          "Use a confirmation before destructive removal, such as: 'Remove this availability
          request?'" — opened by the swipe-revealed Remove button above, not by the swipe itself,
          so a swipe alone never removes anything. Distinct from Deny: this never notifies the
          team member and never records a decision on the request's merits, only that HR cleaned
          it up (see removeAvailabilitySubmission's own comment for the full reasoning). */}
      {removing && (
        <div className="mt-3.5 flex flex-col gap-2.5 bg-white/15 rounded-xl p-3">
          <p className="text-sm font-semibold text-white">Remove this availability request?</p>
          <p className="text-xs text-white/80">
            This is administrative cleanup, not a decision — it won&rsquo;t notify{" "}
            {isSelf ? "you" : r.employeeName}, and HR keeps an internal record even after it&rsquo;s
            removed.
            {hasLinkedShift &&
              " A shift already scheduled from this request stays exactly as it is — removing the request will not cancel or change it."}
          </p>
          {removeError && <p className="text-xs font-medium text-rose-50">{removeError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRemoveCancel}
              disabled={busy}
              className="rounded-full bg-white/15 border border-white/35 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onRemoveConfirm(r.id)}
              disabled={busy}
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
            >
              {busy ? "Removing…" : "Remove request"}
            </button>
          </div>
        </div>
      )}

      {openChip && (
        <div className="mt-3.5 space-y-3.5">
          {/* Phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): Approving
              availability is not the same as scheduling a shift — "Availability must not
              automatically become a confirmed shift." Only an APPROVED date ever gets this
              row; it either shows the confirmed Shift's own status (already converted) or a
              "Confirm as Shift" button that creates one via convert-to-shift. */}
          {r.status === "APPROVED" && (() => {
            const existingShift = shiftsByDate.get(`${r.id}:${openChip.date}`);
            const isConverting = convertingDate === `${r.id}:${openChip.date}`;
            return (
              <div className="flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
                <CalendarIcon className="h-3.5 w-3.5 text-white/80 shrink-0" />
                {existingShift ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white/85">Scheduled as a shift</span>
                    <ShiftStatusPill status={existingShift.displayStatus} />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onConvertToShift(r.id, openChip.date)}
                    disabled={isConverting}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-sm hover:brightness-95 disabled:opacity-60"
                    style={{ color: tone.to }}
                  >
                    {isConverting ? "Scheduling…" : "Confirm as Shift"}
                  </button>
                )}
              </div>
            );
          })()}

          {/* CB, Sept 2026: "I like how we have a texting feature but I feel like we should be
              also able to push different tasks within that specific day" — a discrete,
              checkable item per date, with its own two-way approval (DateTasksPanel pushes it,
              the employee's dashboard marks it done, this panel confirms it). Correction brief
              #2: each task now carries its own comment thread (DateTaskRow) instead of sharing
              one standalone conversation with every other task on this date — see this
              component's own doc comment for what that replaced. */}
          <div>
            <p className="text-xs font-semibold text-white/80 mb-1.5 flex items-center gap-1.5">
              <ChecklistIcon className="h-3.5 w-3.5 text-white/80" />
              {openChip.dateLabel} — tasks
            </p>
            <DateTasksPanel employeeId={r.employeeId} taskDate={openChip.date} viewerId={viewerId} />
          </div>
        </div>
      )}
    </div>
  );
}
