"use client";

import { useEffect, useState } from "react";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";
import MyAvailabilityPreview from "@/components/MyAvailabilityPreview";
import TimeOffRequests from "@/components/TimeOffRequests";
import type { AvailabilityDTO, AvailabilitySlot } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * "Availability" (CB, Sept 2026): tap the dates you're available on a calendar, same
 * experience as My Time, and submit them for a supervisor or HR/Super Admin to approve — "so
 * that we don't have to manually keep on asking them what's their availability." Every
 * submission is kept as its own record (TeamAvailabilitySection / AvailabilityAdminView), not
 * a single pattern that gets overwritten, so there's a real history of what was actually
 * offered and approved over time.
 *
 * Deliberately its own page rather than folded into My Time: that page already covers actual
 * worked hours and time-off requests, and this is conceptually the same *kind* of thing (dates
 * on a calendar, submit, get approved) but a different subject entirely.
 */
export default function AvailabilityView({ employeeId }: { employeeId: string }) {
  const [submissions, setSubmissions] = useState<AvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Which submission (if any) a clear/cancel request is currently in flight for — lets that
  // one submission's button show a busy state without a whole separate loading screen.
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // CB, Sept 2026: "if I click on one of the dates and I say clear... it deletes all of them
  // that I selected" — a single-date removal within a multi-date submission, tracked separately
  // from cancellingId (which is submission-wide) so just the one date's own button goes busy.
  // Keyed "submissionId:date" since a submission alone doesn't uniquely identify which of its
  // dates is being removed.
  const [removingDateKey, setRemovingDateKey] = useState<string | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/availability");
      if (!res.ok) throw new Error();
      const data: { submissions: AvailabilityDTO[] } = await res.json();
      setSubmissions(data.submissions);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleSubmit(slots: AvailabilitySlot[], note?: string) {
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to submit your availability. Please try again.");
        return;
      }
      setSubmissions((prev) => [data, ...prev]);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Clearing a Pending or Denied submission of your own (CB, Sept 2026: "they shouldn't just
  // be set in stone") — updates that one row in place to CANCELLED rather than refetching the
  // whole list, same pattern handleSubmit already uses for a freshly-created one.
  async function handleCancel(submissionId: string) {
    setCancellingId(submissionId);
    try {
      const res = await fetch(`/api/availability/${submissionId}/cancel`, { method: "POST" });
      if (!res.ok) return;
      const updated: AvailabilityDTO = await res.json();
      setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? updated : s)));
    } finally {
      setCancellingId(null);
    }
  }

  // Removes just one date from a Pending/Denied submission — the rest of that submission's
  // dates stay exactly as they were (see removeAvailabilityDate's doc comment).
  async function handleRemoveDate(submissionId: string, date: string) {
    const key = `${submissionId}:${date}`;
    setRemovingDateKey(key);
    try {
      const res = await fetch(`/api/availability/${submissionId}/dates/${date}`, { method: "DELETE" });
      if (!res.ok) return;
      const updated: AvailabilityDTO = await res.json();
      setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? updated : s)));
    } finally {
      setRemovingDateKey(null);
    }
  }

  return (
    // A Fragment, not a single wrapping div — the h-full block below needs to be a DIRECT
    // child of `main` (see (portal)/layout.tsx) for its own md:h-full to resolve against
    // main's actual height; nesting it one level deeper to add the Time Off section as a
    // sibling would break that percentage and undo the whole scroll-containment fix described
    // in its own comment below. The Time Off block after it is deliberately plain, unbounded
    // document flow — same as every other simple page in this app (My Time, most notably) —
    // so `main`'s own md:overflow-y-auto just scrolls a little further to reveal it, rather
    // than trying to squeeze it into the calendar's fixed-height budget.
    <>
      {/* md:h-full md:flex md:flex-col md:min-h-0 (CB, Sept 2026, restructuring this page's
          layout): gives AvailabilityCalendar's own row a real, bounded height to stretch into —
          exactly `main`'s own available height under the portal shell's fixed header — instead
          of the calendar sizing itself to its content and letting `main` scroll the whole page
          as one piece. Mobile is untouched (no md: prefix means none of this applies below the
          breakpoint): the page still scrolls normally there, same as before. */}
      <div className="md:h-full md:flex md:flex-col md:min-h-0">
        <h1 className="page-title text-2xl mb-1 md:shrink-0">Availability</h1>
        <p className="text-sm text-muted mb-4 md:shrink-0">
          Tap the dates you&apos;re available, set a time for each, and submit them for your
          supervisor or HR to approve — so they don&apos;t have to ask you individually.
        </p>

        {/* CB, Sept 2026: wanted "a preview of the dates and times... selected," "cleanly," next
            to the calendar itself — this was briefly on My Time, then moved here per her follow-up
            so Availability is the one place for everything about when you're free to work. Capped
            height + its own scroll on desktop (md:max-h-56 md:overflow-y-auto) so a long submission
            history doesn't eat into the calendar row's own space below; unconstrained on mobile,
            where the whole page already scrolls as one piece. showLink={false}: a "submit or
            edit" link back to this same page would be circular. */}
        {loadState === "ready" && submissions.length > 0 && (
          <div className="mb-4 md:shrink-0 md:max-h-56 md:overflow-y-auto">
            <MyAvailabilityPreview title="Your submissions" showLink={false} />
          </div>
        )}

        {loadState === "loading" && <div className="h-64 rounded-xl border border-border bg-surface animate-pulse" />}

        {loadState === "error" && (
          <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
            Unable to load your availability. Please try again or contact HR.
          </div>
        )}

        {loadState === "ready" && (
          <AvailabilityCalendar
            controls={{
              employeeId,
              submissions,
              onSubmit: handleSubmit,
              submitting,
              error,
              onCancel: handleCancel,
              cancellingId,
              onRemoveDate: handleRemoveDate,
              removingDateKey,
            }}
          />
        )}
      </div>

      {/* CB, Sept 2026: "I don't see [time off] on the availability calendar to make those
          adjustments... it needs to be multifunctional" — the exact same Time Off widget My
          Time renders, so requesting/viewing/cancelling time off is reachable from here too,
          without teaching the calendar above (already the most complex piece in this app) a
          second, unrelated kind of request. */}
      <div className="max-w-6xl mt-8 md:mt-10">
        <TimeOffRequests employeeId={employeeId} />
      </div>
    </>
  );
}
