"use client";

import { useState } from "react";
import Link from "next/link";
import PtoStatusPill from "@/components/PtoStatusPill";
import { TrashIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { PtoStatus, PtoType } from "@/types";

/** recentPto is read straight off Prisma (tx.ptoRequest.findMany), not converted to a DTO —
 *  it never leaves the server, so the extra round-trip through a string-dates shape buys
 *  nothing. This is that raw row's shape, just narrowed to the fields this section reads. */
export type RecentPtoRow = { id: string; type: PtoType; status: PtoStatus; startDate: Date; endDate: Date };

// Extracted from dashboard/page.tsx (Sept 2026) so the new combined Availability detail page
// (dashboard/availability/page.tsx) can show the exact same "Time off" list CB already
// approved on the dashboard, rather than a second hand-copied version that could drift.
//
// CB, round five, circling old "Cancelled" entries on this list: "I should be able to delete
// certain things." A client component now (was a plain server-rendered list before) so that
// delete can happen in place — `rows` starts from the server-supplied `recentPto` prop and is
// only ever trimmed locally after a successful delete, never re-fetched, since this is already
// the newest-3 list the dashboard itself loaded.
export default function TimeOffSection({
  className,
  recentPto,
}: {
  className?: string;
  recentPto: RecentPtoRow[];
}) {
  const [rows, setRows] = useState(recentPto);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/pto/requests/${id}`, { method: "DELETE" });
      if (res.ok) setRows((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Time off</h2>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          No time-off requests yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center hover:bg-black/[0.02] transition-colors">
              {/* Links through to My Time (CB, Sept 2026: "I don't see where Sean could see
                  those messages") — same "tap through to where the detail actually lives"
                  pattern AvailabilityStatusSection already uses for its own rows. */}
              <Link href="/time" className="flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="truncate">
                  {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate.toISOString(), r.endDate.toISOString())}
                </span>
                <PtoStatusPill status={r.status} />
              </Link>
              {/* Cancelled-only — that's the one status with nothing left for anyone to act on
                  or refer back to, matching exactly what CB circled. A separate button (not
                  nested inside the Link above) so this stays valid, clickable markup. */}
              {r.status === "CANCELLED" && (
                <button
                  type="button"
                  onClick={() => handleDelete(r.id)}
                  disabled={deletingId === r.id}
                  aria-label="Delete this request"
                  className="shrink-0 h-8 w-8 mr-2.5 rounded-full flex items-center justify-center text-muted hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
