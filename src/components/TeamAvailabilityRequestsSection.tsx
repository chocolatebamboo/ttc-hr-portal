import Link from "next/link";
import { formatSlotDate } from "@/lib/availability-format";
import type { AdminAvailabilityDTO, AvailabilitySlot } from "@/types";

/** Same one-line "Thu, Sep 17 +2 more" shape as AvailabilityStatusSection's own summarizeSlots —
 *  duplicated rather than imported since that one lives in the employee-facing file and this is
 *  the admin-facing counterpart; nothing here needs slot times, just enough to place each
 *  request at a glance next to whose it is. */
function summarizeSlots(slots: AvailabilitySlot[]): string {
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
  const first = formatSlotDate(sorted[0].date);
  return sorted.length === 1 ? first : `${first} +${sorted.length - 1} more`;
}

// A Home page sidebar widget stays a glance, not a queue — past this many rows the header's own
// "Review →" link (into the full Team availability requests list on /availability) is the way
// to see the rest, same "cap here, full list lives on its own page" split AnnouncementsSection
// uses via dashboard/page.tsx's own .slice(0, 3) for announcements.
const MAX_SHOWN = 5;

/**
 * CB, Sept 2026: "I want that to be where the announcements are... for the admin, that would be
 * covering, you know, schedules and stuff like that." An admin-only counterpart to
 * AnnouncementsSection/NeedsAttentionSection, in that same Home page sidebar spot — CB
 * specifically wants her team's pending availability requests visible the moment she opens the
 * app, not just reachable by remembering to check the Availability tab. Deliberately a compact,
 * read-only summary (whose request + which dates, tap through) rather than the full Approve
 * all/Deny all card TeamAvailabilityCards already renders on the Availability page itself — same
 * "clean list here, full detail and actions on the dedicated page" split Needs your attention and
 * Announcements already use right next to it, confirmed over the alternative (embedding the full
 * interactive card here) as the one that keeps this slot clean rather than heavy.
 *
 * Renamed from "Availability requests" to "Team availability requests" everywhere it appears
 * (here and the heading above TeamAvailabilityCards on /availability) — CB: pairs with the
 * "Time off requests" heading right below it on that same page, and reads unambiguously as HER
 * team's requests to review, not her own.
 *
 * Hidden entirely when there's nothing pending, same as Needs your attention, rather than an
 * always-there "nothing pending" placeholder — this is meant to disappear the moment the queue's
 * clear, not sit there as permanent chrome the way Announcements (which always has *something* to
 * show, even if it's just "No announcements right now") does.
 */
export default function TeamAvailabilityRequestsSection({
  className,
  pending,
}: {
  className?: string;
  pending: AdminAvailabilityDTO[];
}) {
  if (pending.length === 0) return null;
  const shown = pending.slice(0, MAX_SHOWN);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-muted">
          Team availability requests <span className="font-normal">({pending.length})</span>
        </h2>
        <Link href="/availability" className="text-xs font-medium text-accent-ink hover:underline">
          Review →
        </Link>
      </div>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {shown.map((r) => (
          <Link
            key={r.id}
            href="/availability"
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
          >
            <span className="truncate font-medium">{r.employeeName}</span>
            <span className="text-muted text-xs whitespace-nowrap shrink-0">{summarizeSlots(r.slots)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
