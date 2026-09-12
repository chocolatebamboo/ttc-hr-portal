"use client";

import { useEffect, useRef, useState } from "react";
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
  // CB, Sept 2026: "options to see and make time off if needed" right from the calendar's own
  // date-tap popup — set when "Request time off instead" is used there, and handed down into
  // TimeOffRequests so its form opens pre-filled with those dates. See TimeOffRequests'
  // prefillRequest prop for why `nonce` (not just the dates) is what actually triggers it.
  const [ptoPrefillRequest, setPtoPrefillRequest] = useState<{ startDate: string; endDate: string; nonce: number } | null>(
    null
  );
  // So requesting time off from the calendar can scroll the section into view even though it's
  // already above the calendar on the page — useful on a small phone screen where it may have
  // scrolled out of view while using the calendar below it.
  const timeOffSectionRef = useRef<HTMLDivElement | null>(null);

  function handleRequestTimeOffForDates(dates: string[]) {
    if (dates.length === 0) return;
    const sorted = [...dates].sort();
    setPtoPrefillRequest({ startDate: sorted[0], endDate: sorted[sorted.length - 1], nonce: Date.now() });
    timeOffSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
    <div className="md:h-full md:flex md:flex-col md:min-h-0">
      <h1 className="page-title text-2xl mb-1 md:shrink-0">Availability</h1>
      <p className="text-sm text-muted mb-4 md:shrink-0">
        Tap the dates you&apos;re available, set a time for each, and submit them for your
        supervisor or HR to approve — so they don&apos;t have to ask you individually.
      </p>

      {loadState === "ready" && submissions.length > 0 && (
        <div className="mb-4 md:shrink-0 md:max-h-56 md:overflow-y-auto">
          <MyAvailabilityPreview title="Your submissions" showLink={false} />
        </div>
      )}

      <div ref={timeOffSectionRef} className="mb-4 md:shrink-0 md:max-h-80 md:overflow-y-auto">
        <TimeOffRequests employeeId={employeeId} prefillRequest={ptoPrefillRequest} />
      </div>

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
            onRequestTimeOff: handleRequestTimeOffForDates,
          }}
        />
      )}
    </div>
  );
}
