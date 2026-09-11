import Link from "next/link";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { formatSlotDate } from "@/lib/availability-format";
import type { AvailabilityDTO, AvailabilitySlot } from "@/types";

/** "Thu, Sep 17" for a single-date submission, "Thu, Sep 17 +2 more" for a multi-date one —
 *  compact enough for one line next to a status pill, same spirit as TimeOffSection's
 *  PTO_TYPE_LABEL + formatDateRange pairing just without a fixed end date to range against,
 *  since a submission's dates aren't necessarily consecutive (see AvailabilitySlot's doc
 *  comment in src/types/index.ts). */
function summarizeSlots(slots: AvailabilitySlot[]): string {
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
  const first = formatSlotDate(sorted[0].date);
  return sorted.length === 1 ? first : `${first} +${sorted.length - 1} more`;
}

// CB, Sept 2026: the employee-facing half of the availability notification — always visible
// once there's history, same "Time off" pattern rather than something that has to be
// dismissed, so an approval or denial is just sitting there next time the team member looks,
// no separate unread state to track. Extracted from dashboard/page.tsx so the combined
// Availability detail page (dashboard/availability/page.tsx) can show the exact same list
// rather than a hand-copied duplicate that could drift.
export default function AvailabilityStatusSection({
  className,
  recentAvailability,
}: {
  className?: string;
  recentAvailability: AvailabilityDTO[];
}) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-muted">Availability</h2>
        {/* CB, round four: "if they click availability... toward the bottom on the home
            page... it should go to that page of the availability that's on the pink" — same
            /dashboard/availability destination as the pink StatCard above. */}
        <Link href="/dashboard/availability" className="text-xs font-medium text-accent-ink hover:underline">
          See all →
        </Link>
      </div>
      {recentAvailability.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          No availability submitted yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {recentAvailability.map((a) => (
            <Link
              key={a.id}
              href="/availability"
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
            >
              <span className="truncate">{summarizeSlots(a.slots)}</span>
              <AvailabilityStatusPill status={a.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
