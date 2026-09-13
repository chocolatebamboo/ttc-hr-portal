"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { TrashIcon } from "@/components/icons";
import { slotChips } from "@/lib/availability-format";
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

      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {submissions.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                {s.note ? (
                  <p className="text-sm text-muted italic truncate">&ldquo;{s.note}&rdquo;</p>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2 shrink-0">
                  <AvailabilityStatusPill status={s.status} />
                  {/* CB, Sept 2026: "the deleting isn't working on these" — a Cancelled
                      submission has nothing left to act on, so it can go away for good; same
                      Cancelled-only rule as the Time Off list's own delete. */}
                  {s.status === "CANCELLED" && (
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      aria-label="Delete this submission"
                      className="h-6 w-6 flex items-center justify-center rounded-full text-muted hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {slotChips(s.slots).map((c) => (
                  <div
                    key={c.date}
                    className="flex flex-col items-start rounded-lg bg-black/[0.03] px-2.5 py-1.5 leading-tight"
                  >
                    <span className="text-xs font-semibold">{c.dateLabel}</span>
                    <span className="text-[11px] text-muted">{c.timeLabel}</span>
                  </div>
                ))}
              </div>

              {/* Phase 2 (client spec, Sept 2026): "Adjust the proposed time and send it to the
                  team member for confirmation" — the reviewer's counter-proposed times, shown
                  next to (not instead of) the originally-submitted ones above so it's clear
                  what's changing. */}
              {s.status === "ADJUSTMENT_REQUESTED" && s.adjustedSlots && (
                <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-xs font-semibold text-amber-800 mb-1.5">Your supervisor proposed:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {slotChips(s.adjustedSlots).map((c) => (
                      <div key={c.date} className="flex flex-col items-start rounded-lg bg-white px-2.5 py-1.5 leading-tight">
                        <span className="text-xs font-semibold">{c.dateLabel}</span>
                        <span className="text-[11px] text-muted">{c.timeLabel}</span>
                      </div>
                    ))}
                  </div>
                  {s.reviewComment && (
                    <p className="text-xs text-amber-800 italic mt-1.5">&ldquo;{s.reviewComment}&rdquo;</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => handleRespondAdjustment(s.id, true)}
                      disabled={respondingId === s.id}
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespondAdjustment(s.id, false)}
                      disabled={respondingId === s.id}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              )}
              {s.status !== "ADJUSTMENT_REQUESTED" && s.status !== "PENDING" && s.reviewComment && (
                <p className="text-xs text-muted italic mt-2">Reviewer note: &ldquo;{s.reviewComment}&rdquo;</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
