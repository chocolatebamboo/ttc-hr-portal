"use client";

import { useEffect, useState } from "react";
import PtoStatusPill from "@/components/PtoStatusPill";
import TeamNotesThread from "@/components/TeamNotesThread";
import SwipeReveal from "@/components/SwipeReveal";
import { ChatIcon, TrashIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { PtoRequestDTO, PtoType, TeamNoteTopicCountDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

const PTO_TYPE_OPTIONS: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];

/** Values a PTO request is submitted with (type/hours/optional reason) — the date range comes
 *  separately from wherever the request originated. */
export type PtoQuickRequestValues = { type: PtoType; hours: number; reason?: string };

/**
 * Self-contained "request time off / see your requests" widget — originally only on My Time,
 * now also on Availability. CB, Sept 2026: "I don't see [time off] on the availability
 * calendar to make those adjustments... it needs to be multifunctional" — rather than teach
 * the already-complex AvailabilityCalendar a second, unrelated kind of request, this is the
 * exact same proven component (state, handlers, swipe-to-cancel/delete, per-request messaging)
 * dropped onto both pages, so either one has full time-off functionality without touching that
 * calendar at all.
 *
 * NOT the same component as TimeOffSection (src/components/TimeOffSection.tsx) — that one is
 * the dashboard's own read-only "recent time off" summary (server-supplied `recentPto`, no
 * fetching of its own). Similar name, different job; kept as two files on purpose.
 */
export default function TimeOffRequests({
  employeeId,
  refreshSignal,
  showHeading = true,
}: {
  employeeId: string;
  /** CB, Sept 2026: on the Availability page, a time-off request can now be made directly from
   *  the calendar's own date-tap popup rather than through this component's own form (see
   *  AvailabilityCalendarControls.onSubmitTimeOff) — this list otherwise only loads once on its
   *  own mount, with no way to know a request landed elsewhere on the page. A fresh value here
   *  (e.g. Date.now(), same "nonce" idea as before) triggers a refetch; left undefined/null,
   *  nothing changes, which is what My Time's own use of this component relies on. */
  refreshSignal?: number | null;
  /** CB, Sept 2026 — wanting this section collapsed behind its own toggle on Availability so
   *  the calendar gets more room by default: AvailabilityView's own disclosure button already
   *  shows "Time off" before this is ever expanded, so the "Your time-off requests" text here
   *  would just repeat it. The "Request time off" button stays either way (that's a real
   *  control, not a label) — only the heading text hides. Defaults to true so My Time's own use
   *  of this component (its own page, no outer toggle) is unaffected. */
  showHeading?: boolean;
}) {
  const [ptoRequests, setPtoRequests] = useState<PtoRequestDTO[]>([]);
  const [ptoLoadState, setPtoLoadState] = useState<LoadState>("loading");
  const [ptoSubmitting, setPtoSubmitting] = useState(false);
  const [ptoCancellingId, setPtoCancellingId] = useState<string | null>(null);
  // CB, round five, on the dashboard's own Time off list first, now asking for the same thing
  // here: "I should be able to delete these as well" — a Cancelled request can be removed for
  // good (see deletePtoRequest's doc comment in src/lib/pto-actions.ts for why only Cancelled
  // qualifies), same underlying DELETE route the dashboard's TimeOffSection already uses.
  const [ptoDeletingId, setPtoDeletingId] = useState<string | null>(null);
  const [ptoError, setPtoError] = useState<string | undefined>();
  const [standaloneFormOpen, setStandaloneFormOpen] = useState(false);
  // Set while adjusting a denied request — CB, round four: "if they got denied... we should be
  // able to adjust it... to select a different time or date," same parity Availability already
  // has via AvailabilityCalendar's startResubmit. Seeds the standalone form with the denied
  // request's values; submitting always creates a brand-new PENDING request rather than editing
  // the denied one in place, same "never edit history" shape as Availability's resubmit.
  const [resubmitFrom, setResubmitFrom] = useState<PtoRequestDTO | null>(null);
  // Which request's conversation (if any) is expanded below the list — CB, Sept 2026: "I don't
  // see where Sean could see those messages," same per-request conversation admin cards
  // already open (TeamPtoCards' topicType="PTO_REQUEST"), now reachable from the employee's
  // own side too.
  const [openPtoId, setOpenPtoId] = useState<string | null>(null);
  const [ptoMessageCounts, setPtoMessageCounts] = useState<Map<string, number>>(new Map());

  async function loadPtoCounts() {
    try {
      const res = await fetch(`/api/team-notes/${employeeId}/topic-counts`);
      if (!res.ok) return;
      const data: { counts: TeamNoteTopicCountDTO[] } = await res.json();
      const map = new Map<string, number>();
      for (const c of data.counts) {
        if (c.topicType !== "PTO_REQUEST") continue;
        map.set(c.topicId, c.total);
      }
      setPtoMessageCounts(map);
    } catch {
      // best-effort — a missing badge isn't worth failing the list over
    }
  }

  async function loadPto() {
    setPtoLoadState("loading");
    try {
      const res = await fetch("/api/pto/requests");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPtoRequests(data.requests);
      setPtoLoadState(data.requests.length === 0 ? "empty" : "ready");
    } catch {
      setPtoLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPto();
    loadPtoCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshSignal == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPto();
  }, [refreshSignal]);

  async function submitPtoRequest(range: { startDate: string; endDate: string }, values: PtoQuickRequestValues) {
    setPtoSubmitting(true);
    setPtoError(undefined);
    try {
      const res = await fetch("/api/pto/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: values.type,
          startDate: range.startDate,
          endDate: range.endDate,
          hours: values.hours,
          reason: values.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPtoError(data.error ?? "Unable to submit your request. Please try again.");
        return;
      }
      setStandaloneFormOpen(false);
      setResubmitFrom(null);
      await loadPto();
    } catch {
      setPtoError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setPtoSubmitting(false);
    }
  }

  async function cancelPtoRequest(requestId: string) {
    setPtoCancellingId(requestId);
    try {
      await fetch(`/api/pto/requests/${requestId}/cancel`, { method: "POST" });
      await loadPto();
    } finally {
      setPtoCancellingId(null);
    }
  }

  async function deletePtoRequestRow(requestId: string) {
    setPtoDeletingId(requestId);
    try {
      const res = await fetch(`/api/pto/requests/${requestId}`, { method: "DELETE" });
      if (res.ok) setPtoRequests((prev) => prev.filter((r) => r.id !== requestId));
    } finally {
      setPtoDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {showHeading ? <h2 className="text-sm font-medium text-muted">Your time-off requests</h2> : <span />}
        <button
          onClick={() => {
            setResubmitFrom(null);
            setStandaloneFormOpen((o) => !o);
          }}
          className={standaloneFormOpen ? "btn-neutral text-xs px-3 py-1.5" : "text-xs text-accent-ink font-medium hover:underline"}
        >
          {standaloneFormOpen ? "Cancel" : "Request time off"}
        </button>
      </div>

      {standaloneFormOpen && (
        <StandalonePtoForm
          key={resubmitFrom?.id ?? "new"}
          onSubmit={submitPtoRequest}
          submitting={ptoSubmitting}
          error={ptoError}
          initial={
            resubmitFrom
              ? {
                  type: resubmitFrom.type,
                  startDate: resubmitFrom.startDate,
                  endDate: resubmitFrom.endDate,
                  hours: String(resubmitFrom.hours),
                  reason: resubmitFrom.reason ?? "",
                }
              : undefined
          }
        />
      )}

      {ptoLoadState === "loading" && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {ptoLoadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your time-off requests. Please try again or contact HR.
        </div>
      )}

      {ptoLoadState === "empty" && !standaloneFormOpen && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          You haven&apos;t requested any time off yet.
        </div>
      )}

      {ptoLoadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {ptoRequests.map((r) => {
            const msgCount = ptoMessageCounts.get(r.id) ?? 0;
            const open = openPtoId === r.id;
            const rowContent = (
              <div className="px-4 py-3.5 bg-surface">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
                    </p>
                    <p className="text-xs text-muted">
                      {r.hours} hours{r.reason ? ` — ${r.reason}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PtoStatusPill status={r.status} />
                    {r.status === "PENDING" && (
                      <button
                        onClick={() => cancelPtoRequest(r.id)}
                        disabled={ptoCancellingId === r.id}
                        className="text-xs text-muted hover:text-accent underline disabled:opacity-50"
                      >
                        {ptoCancellingId === r.id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                    {/* CB, round five: "I should be able to delete these as well" — same
                        Cancelled-only rule as the dashboard's TimeOffSection. Text link here
                        (not just the swipe action below) for anyone on a non-touch device. */}
                    {r.status === "CANCELLED" && (
                      <button
                        onClick={() => deletePtoRequestRow(r.id)}
                        disabled={ptoDeletingId === r.id}
                        className="text-xs text-muted hover:text-accent underline disabled:opacity-50"
                      >
                        {ptoDeletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
                {r.status === "DENIED" && r.reviewComment && (
                  <p className="text-xs text-accent mt-1.5">Denied: {r.reviewComment}</p>
                )}
                {r.status === "DENIED" && (
                  <button
                    onClick={() => {
                      setResubmitFrom(r);
                      setStandaloneFormOpen(true);
                    }}
                    className="mt-1.5 text-xs font-medium text-accent-ink hover:underline"
                  >
                    Adjust &amp; resubmit
                  </button>
                )}

                {/* CB, Sept 2026: "I send it to Sean, I don't see where Sean could see those
                    messages" — the employee-side half of the same per-request conversation
                    TeamPtoCards opens from the admin side (topicType="PTO_REQUEST"). */}
                <button
                  type="button"
                  onClick={() => setOpenPtoId(open ? null : r.id)}
                  className={`mt-2 flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 transition-colors ${
                    msgCount > 0
                      ? "bg-accent/10 text-accent-ink hover:bg-accent/20"
                      : "text-muted hover:text-accent-ink hover:bg-black/[0.03]"
                  }`}
                >
                  <ChatIcon className="h-3.5 w-3.5" />
                  {msgCount > 0 ? `${msgCount} message${msgCount === 1 ? "" : "s"}` : "Message about this request"}
                </button>

                {open && (
                  <div className="mt-2">
                    <TeamNotesThread
                      employeeId={employeeId}
                      viewerId={employeeId}
                      topicType="PTO_REQUEST"
                      topicId={r.id}
                      placeholder="Message your supervisor or HR about this request…"
                      onMessagePosted={loadPtoCounts}
                    />
                  </div>
                )}
              </div>
            );

            // CB, round four: "I should be able to slide to the left... and delete it" — a
            // PENDING request swipes to Cancel (cancelPtoRequest itself enforces that only
            // PENDING can be cancelled). CB, round five, the same swipe now also covers
            // Cancelled rows — "I should be able to delete these as well" — swiping there
            // calls the real DELETE (deletePtoRequestRow) instead, since a Cancelled request
            // has nothing left to "cancel" into. The inline text link above (Cancel/Delete)
            // stays either way, for anyone on a non-touch device.
            if (r.status === "PENDING") {
              return (
                <SwipeReveal
                  key={r.id}
                  actionSide="right"
                  actionLabel="Cancel"
                  actionIcon={<TrashIcon className="h-4 w-4" />}
                  actionClassName="bg-rose-600 text-white"
                  busy={ptoCancellingId === r.id}
                  onAction={() => cancelPtoRequest(r.id)}
                >
                  {rowContent}
                </SwipeReveal>
              );
            }
            if (r.status === "CANCELLED") {
              return (
                <SwipeReveal
                  key={r.id}
                  actionSide="right"
                  actionLabel="Delete"
                  actionIcon={<TrashIcon className="h-4 w-4" />}
                  actionClassName="bg-rose-600 text-white"
                  busy={ptoDeletingId === r.id}
                  onAction={() => deletePtoRequestRow(r.id)}
                >
                  {rowContent}
                </SwipeReveal>
              );
            }
            return <div key={r.id}>{rowContent}</div>;
          })}
        </div>
      )}
    </div>
  );
}

function StandalonePtoForm({
  onSubmit,
  submitting,
  error,
  initial,
}: {
  onSubmit: (range: { startDate: string; endDate: string }, values: PtoQuickRequestValues) => void;
  submitting: boolean;
  error?: string;
  /** Pre-fills the form from a denied request being adjusted & resubmitted — omitted for a
   *  plain "Request time off." */
  initial?: { type: PtoType; startDate: string; endDate: string; hours: string; reason: string };
}) {
  const [type, setType] = useState<PtoType>(initial?.type ?? "VACATION");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [hours, setHours] = useState(initial?.hours ?? "");
  const [reason, setReason] = useState(initial?.reason ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ startDate, endDate }, { type, hours: Number(hours), reason: reason.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-5 space-y-4 mb-3">
      {initial && (
        <p className="text-xs font-medium text-accent-ink -mb-1">
          Adjusting your denied request — submitting sends this as a brand-new request.
        </p>
      )}
      <div>
        <label className="block text-sm font-medium mb-1.5">Type of leave</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PtoType)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        >
          {PTO_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {PTO_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Start date</label>
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">End date</label>
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Number of hours</label>
        <input
          type="number"
          required
          min="0.5"
          step="0.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="e.g. 8"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Reason / comment (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}

      <button type="submit" disabled={submitting} className="btn-primary px-5 py-2.5 text-sm">
        {submitting ? "Submitting…" : "Submit Request"}
      </button>
    </form>
  );
}
