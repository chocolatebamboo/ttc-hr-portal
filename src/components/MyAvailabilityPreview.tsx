"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
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
 */
export default function MyAvailabilityPreview({
  title = "Your availability",
  showLink = true,
}: {
  title?: string;
  showLink?: boolean;
}) {
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
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        {showLink && (
          <Link href="/availability" className="text-xs font-medium text-accent-ink hover:underline">
            Submit or edit →
          </Link>
        )}
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
