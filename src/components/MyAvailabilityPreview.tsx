"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import SwipeReveal from "@/components/SwipeReveal";
import { TrashIcon } from "@/components/icons";
import { slotChips } from "@/lib/availability-format";
import { toneForStatus, STATUS_TONE } from "@/lib/status-tone";
import type { AvailabilityDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/**
 * CB, Sept 2026: My Time should show "a preview of the dates and times... selected in the
 * availability," not "a second calendar." CB's follow-up (same day): that preview belongs on
 * the Availability page itself, alongside the calendar you actually submit from, rather than on
 * My Time — so each page stays about one thing (Availability = when you're free to work; My
 * Time = hours actually worked). This is deliberately a plain read-only list, not a calendar
 * widget: every date you've submitted, with its status, in one scannable place next to the
 * calendar that made it.
 *
 * `showLink`/`title` let the one component serve both call sites without reading oddly on
 * either: on the Availability page itself, a "Submit or edit →" link back to the very page it's
 * already on would be circular, so AvailabilityView passes showLink={false}.
 *
 * `showHeading` (CB, Sept 2026 — wanting "Your submissions" collapsed behind its own toggle so
 * the calendar gets more room by default): AvailabilityView now wraps this whole component in
 * its own collapsible disclosure button, which already shows the "Your submissions" label (plus
 * a count) before it's ever expanded — rendering this component's own heading again right below
 * would just repeat that same text. Defaults to true so the one other place nothing changes.
 */
export default function MyAvailabilityPreview({
  title = "Your availability",
  showLink = true,
  showHeading = true,
}: {
  title?: string;
  showLink?: boolean;
  showHeading?: boolean;
}) {
  const [submissions, setSubmissions] = useState<AvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // CB, Sept 2026: "the deleting isn't working on these" — pointing at old Cancelled entries
  // sitting in this list with no way to get rid of them. Which one (if any) a delete is
  // currently in flight for, so only that row shows a busy state.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Phase 2 (client spec, Sept 2026): which submission (if any) an accept/decline response to a
  // pending ADJUSTMENT_REQUESTED is currently in flight for — same single-row-busy shape as
  // deletingId above.
  const [respondingId, setRespondingId] = useState<string | null>(null);
  // Redesign follow-up (Sept 2026), CB: "I'm still not able to slide to the left and delete for
  // the submissions... there's no way for me to cancel that." Which submission (if any) a
  // cancel is currently in flight for — same single-row-busy shape as deletingId above, just for
  // the separate cancel action (see cancelAvailabilitySubmission's own doc comment in
  // src/lib/availability.ts for why this is a distinct action from delete: cancel sets a Pending
  // or Denied submission to Cancelled and keeps the record; delete permanently removes an
  // already-Cancelled one).
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoadState("loading");
      try {
        const res = await fetch("/api/availability");
        if (!res.ok) throw new Error();
        const data: { submissions: AvailabilityDTO[] } = await res.json();
        setSubmissions(data.submissions);
        setLoadState(data.submissions.length === 0 ? "empty" : "ready");
      } catch {
        setLoadState("error");
      }
    }
    load();
  }, []);

  // Cancelled-only, same rule as the Time Off list's own delete (see
  // deleteAvailabilitySubmission's doc comment in src/lib/availability.ts) — a Pending, Denied,
  // or Approved submission still means something, so this never touches those.
  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/availability/${id}`, { method: "DELETE" });
      if (res.ok) setSubmissions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  // Redesign follow-up (Sept 2026): the swipe-to-cancel counterpart to handleDelete above — same
  // POST /api/availability/[id]/cancel AvailabilityView's own handleCancel already uses, just
  // called from this list directly. Pending or Denied only (cancelAvailabilitySubmission enforces
  // this server-side too); an Approved submission isn't something the employee unwinds
  // unilaterally, same stance PTO already takes.
  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/availability/${id}/cancel`, { method: "POST" });
      if (!res.ok) return;
      const updated: AvailabilityDTO = await res.json();
      setSubmissions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } finally {
      setCancellingId(null);
    }
  }

  // Phase 2: accepting makes the reviewer's proposed times the real, official ones (this
  // submission becomes Approved); declining leaves the original submitted times untouched and
  // this submission becomes Denied — see respondToAvailabilityAdjustment's own doc comment in
  // src/lib/availability.ts.
  async function handleRespondAdjustment(id: string, accept: boolean) {
    setRespondingId(id);
    try {
      const res = await fetch(`/api/availability/${id}/respond-adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      if (!res.ok) return;
      const updated: AvailabilityDTO = await res.json();
      setSubmissions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } finally {
      setRespondingId(null);
    }
  }

  return (
    <div>
      {showHeading && (
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-muted">{title}</h2>
          {showLink && (
            <Link href="/availability" className="text-xs font-medium text-accent-ink hover:underline">
              Submit or edit →
            </Link>
          )}
        </div>
      )}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-accent">
          Unable to load your availability. Please try again or contact HR.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          {showLink ? (
            <>
              You haven&apos;t submitted any availability yet.{" "}
              <Link href="/availability" className="text-accent-ink font-medium hover:underline">
                Submit some →
              </Link>
            </>
          ) : (
            "You haven't submitted any availability yet — tap dates on the calendar above to get started."
          )}
        </div>
      )}

      {/* CB, Sept 2026: "I like the fact that they have colored backgrounds... I don't see that
          for the availability side... it could get cluttered with just words." Solid colored
          cards now, same tone system the admin-facing team cards already use (src/lib/status-
          tone.ts), instead of a white card with a small pill — and per CB: "when we do approve
          something, then it changes the color," this is the SAME card element recoloring as its
          status changes, not a new one appearing. A submission still Approved-but-awaiting-a-
          task (two-step approval workflow) deliberately keeps reading amber, not pink, until a
          task's actually been pushed — see AvailabilityDTO.awaitingTask's own doc comment. */}
      {loadState === "ready" && (
        <div className="space-y-2.5">
          {submissions.map((s) => {
            const plain = s.status === "DENIED" || s.status === "CANCELLED";
            const stillInProgress = s.status === "APPROVED" && s.awaitingTask;
            const tone = plain ? null : stillInProgress ? STATUS_TONE.PENDING : toneForStatus(s.status);
            // Redesign follow-up (Sept 2026), CB: "I'm still not able to slide to the left and
            // delete for the submissions... there's no way for me to cancel that." Same swipe-
            // reveal pattern used everywhere else in this app (TeamAvailabilityCards, Messages) —
            // a Pending or Denied submission swipes to reveal Cancel; an already-Cancelled one
            // swipes to reveal the real, permanent Delete that used to be a plain always-visible
            // icon button. Approved/Adjustment-requested submissions get neither: nothing here is
            // the employee's to unwind unilaterally once a supervisor's acted on it.
            const canCancel = s.status === "PENDING" || s.status === "DENIED";
            const canDelete = s.status === "CANCELLED";
            const card = (
              <div
                className={`rounded-2xl p-4 ${plain ? "border border-border bg-surface" : ""}`}
                style={
                  tone
                    ? { background: `linear-gradient(150deg, ${tone.from} 0%, ${tone.to} 100%)`, color: "#fff" }
                    : undefined
                }
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  {s.note ? (
                    <p className={`text-sm italic truncate ${plain ? "text-muted" : "text-white/85"}`}>
                      &ldquo;{s.note}&rdquo;
                    </p>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2 shrink-0">
                    <AvailabilityStatusPill status={s.status} awaitingTask={s.awaitingTask} onColor={!plain} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {slotChips(s.slots).map((c) => (
                    <div
                      key={c.date}
                      className={`flex flex-col items-start rounded-lg px-2.5 py-1.5 leading-tight ${
                        plain ? "bg-black/[0.03]" : "bg-white/15"
                      }`}
                    >
                      <span className="text-xs font-semibold">{c.dateLabel}</span>
                      <span className={`text-[11px] ${plain ? "text-muted" : "text-white/80"}`}>{c.timeLabel}</span>
                    </div>
                  ))}
                </div>

                {stillInProgress && (
                  <p className="text-xs text-white/80 mt-2.5">
                    Approved — waiting on a task to be pushed before your shift is confirmed.
                  </p>
                )}

                {/* Phase 2 (client spec, Sept 2026): "Adjust the proposed time and send it to the
                    team member for confirmation" — the reviewer's counter-proposed times, shown
                    next to (not instead of) the originally-submitted ones above so it's clear
                    what's changing. */}
                {s.status === "ADJUSTMENT_REQUESTED" && s.adjustedSlots && (
                  <div className="mt-2.5 rounded-lg bg-white/15 p-2.5">
                    <p className="text-xs font-semibold text-white mb-1.5">Your supervisor proposed:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {slotChips(s.adjustedSlots).map((c) => (
                        <div key={c.date} className="flex flex-col items-start rounded-lg bg-white/90 px-2.5 py-1.5 leading-tight">
                          <span className="text-xs font-semibold text-foreground">{c.dateLabel}</span>
                          <span className="text-[11px] text-muted">{c.timeLabel}</span>
                        </div>
                      ))}
                    </div>
                    {s.reviewComment && (
                      <p className="text-xs text-white/85 italic mt-1.5">&ldquo;{s.reviewComment}&rdquo;</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => handleRespondAdjustment(s.id, true)}
                        disabled={respondingId === s.id}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-sm hover:brightness-95 disabled:opacity-60"
                        style={{ color: STATUS_TONE.PENDING.to }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRespondAdjustment(s.id, false)}
                        disabled={respondingId === s.id}
                        className="text-xs font-medium text-white/85 hover:text-white underline underline-offset-2"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}
                {s.status !== "ADJUSTMENT_REQUESTED" && s.status !== "PENDING" && s.reviewComment && (
                  <p className={`text-xs italic mt-2 ${plain ? "text-muted" : "text-white/80"}`}>
                    Reviewer note: &ldquo;{s.reviewComment}&rdquo;
                  </p>
                )}
              </div>
            );

            if (canCancel) {
              return (
                <SwipeReveal
                  key={s.id}
                  actionSide="right"
                  actionLabel="Cancel"
                  actionIcon={<TrashIcon className="h-4 w-4" />}
                  actionClassName="bg-rose-600 text-white rounded-2xl"
                  busy={cancellingId === s.id}
                  onAction={() => handleCancel(s.id)}
                >
                  {card}
                </SwipeReveal>
              );
            }

            if (canDelete) {
              return (
                <SwipeReveal
                  key={s.id}
                  actionSide="right"
                  actionLabel="Delete"
                  actionIcon={<TrashIcon className="h-4 w-4" />}
                  actionClassName="bg-rose-600 text-white rounded-2xl"
                  busy={deletingId === s.id}
                  onAction={() => handleDelete(s.id)}
                >
                  {card}
                </SwipeReveal>
              );
            }

            return <div key={s.id}>{card}</div>;
          })}
        </div>
      )}
    </div>
  );
}
