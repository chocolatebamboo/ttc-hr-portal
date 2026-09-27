import Link from "next/link";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { initialsOf } from "@/components/TeamAvailabilityCards";
import { formatTime12h } from "@/lib/availability-format";
import type { AdminShiftDTO } from "@/types";

// Same small cycling palette as ScheduleSomeoneSheet's own picker avatars — kept as a local
// copy rather than a shared import (see that file's own doc comment on this same choice).
const AVATAR_COLORS = ["var(--ttc-pink)", "var(--ttc-blue)", "#7c5cff", "var(--ttc-pink-ink)", "var(--muted)"];
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * "Who's working right now" (CB, Sept 2026, admin Home redesign): "I should see a dashboard of
 * pretty much all the different people that have the schedule right now in a clean way... just
 * so I could get like a glance of who is supposed to be working right now." `shifts` is every
 * shift for TODAY only (the dashboard page's own listAdminShifts call with dateFrom/dateTo both
 * set to today) — deliberately every status for the day, not just the ones in progress this
 * exact minute, so a completed morning shift or an upcoming evening one both still show; the
 * status pill is what actually tells the admin who's on right now versus later versus already
 * done. "Full schedule" links to the existing Team Schedule page for anything past a same-day
 * glance (filtering by person/department, cancel/reassign, requests) — this list doesn't
 * duplicate any of that.
 */
export default function TeamScheduleGlance({ shifts }: { shifts: AdminShiftDTO[] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-medium text-muted">Who&apos;s working right now</h2>
        <Link href="/team/schedule" className="text-xs font-medium text-accent-ink hover:underline shrink-0">
          Full schedule →
        </Link>
      </div>

      {shifts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          Nobody&apos;s scheduled today yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
          {shifts.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 px-4 py-3">
              <span
                className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                style={{ background: colorFor(s.employeeId) }}
              >
                {initialsOf(s.employeeName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{s.employeeName}</p>
                <p className="text-xs text-muted truncate">{s.departmentName ?? "—"}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted tabular-nums mb-1">
                  {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
                </p>
                <ShiftStatusPill status={s.displayStatus} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
