import PtoStatusPill from "@/components/PtoStatusPill";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { PtoStatus, PtoType } from "@/types";

/** recentPto is read straight off Prisma (tx.ptoRequest.findMany), not converted to a DTO —
 *  it never leaves the server, so the extra round-trip through a string-dates shape buys
 *  nothing. This is that raw row's shape, just narrowed to the fields this section reads. */
export type RecentPtoRow = { id: string; type: PtoType; status: PtoStatus; startDate: Date; endDate: Date };

// Extracted from dashboard/page.tsx (Sept 2026) so the new combined Availability detail page
// (dashboard/availability/page.tsx) can show the exact same "Time off" list CB already
// approved on the dashboard, rather than a second hand-copied version that could drift.
export default function TimeOffSection({
  className,
  recentPto,
}: {
  className?: string;
  recentPto: RecentPtoRow[];
}) {
  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Time off</h2>
      {recentPto.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          No time-off requests yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {recentPto.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3">
              <p className="text-sm">
                {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate.toISOString(), r.endDate.toISOString())}
              </p>
              <PtoStatusPill status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
