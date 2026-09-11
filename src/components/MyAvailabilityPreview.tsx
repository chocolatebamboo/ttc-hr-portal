"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { slotChips } from "@/lib/availability-format";
import type { AvailabilityDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/**
 * CB, Sept 2026: My Time should show "a preview of the dates and times... selected in the
 * availability," not "a second calendar" — this page already has its own calendar for actual
 * worked hours (TimesheetCalendar), so a second interactive calendar just for availability read
 * as redundant. This is deliberately a plain read-only list, not a calendar widget: every date
 * you've submitted on the Availability page, with its status, in one scannable place. Editing
 * still only happens on the Availability page itself (linked below) — this is a preview, not a
 * second place to submit or change anything.
 */
export default function MyAvailabilityPreview() {
  const [submissions, setSubmissions] = useState<AvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

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

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-muted">Your availability</h2>
        <Link href="/availability" className="text-xs font-medium text-accent-ink hover:underline">
          Submit or edit →
        </Link>
      </div>

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
          You haven&apos;t submitted any availability yet.{" "}
          <Link href="/availability" className="text-accent-ink font-medium hover:underline">
            Submit some →
          </Link>
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
                <AvailabilityStatusPill status={s.status} />
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
