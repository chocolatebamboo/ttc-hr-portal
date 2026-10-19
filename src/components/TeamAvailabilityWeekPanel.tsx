"use client";

import { useState } from "react";
import Link from "next/link";
import { getWeek, formatWeekRange, getPayrollPeriod, payrollPeriodOffsetForDate } from "@/lib/week";
import TeamAvailabilityCards from "@/components/TeamAvailabilityCards";
import { ChartIcon } from "@/components/icons";

/**
 * Oct 2026 (CB, on the Availability mockup's "Team availability requests" section: "I should see
 * an option to kind of look at the past archive ones... or being able to see what's in the
 * future as well"): the same week nav + "This week" badge Team Schedule and Attendance already
 * have — added here so this section reads the same way they do, instead of the old fixed
 * "pending + last 7 days decided, archive the rest" view. A Server Component page (AvailabilityPage)
 * can't own the offset state itself, so this small client wrapper does: it resolves the selected
 * week and hands the bounds down to TeamAvailabilityCards, which does the actual filtering (see
 * that component's own doc comment on its weekStart/weekEnd props) — the Approve/Deny/per-date
 * review machinery underneath is completely unchanged, just scoped to one week at a time now.
 *
 * Oct 2026, round two (CB: "I want to make sure that... the admin will be able to access on the
 * availability page, the two-week report for that specific... pay period"): a small "2-week
 * report" link next to the week nav, resolved from whichever week is currently selected — not a
 * fixed "today's period" link — via payrollPeriodOffsetForDate(week.start)/getPayrollPeriod, same
 * pair MyTasksView's own deep link already uses to land on the right period for an arbitrary
 * date. Deep-links into Reports with `?periodEnd=`, same convention the dashboard's report-ready
 * banner (DashboardNotifications.tsx) already uses. No extra access check needed here: every
 * viewer who can reach this page at all (isAdmin or SUPERVISOR — see AvailabilityAdminView's own
 * `scope` doc comment) already satisfies canAccessReports (src/lib/authorization.ts), which is
 * the exact same isAdmin-or-SUPERVISOR check.
 */
export default function TeamAvailabilityWeekPanel({ viewerId }: { viewerId: string }) {
  const [offset, setOffset] = useState(0);
  const week = getWeek(offset);
  const period = getPayrollPeriod(payrollPeriodOffsetForDate(week.start));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-sm font-medium text-muted">Team availability requests</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <button
              type="button"
              onClick={() => setOffset((o) => o - 1)}
              className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
              aria-label="Previous week"
            >
              ‹
            </button>
            <span className="text-sm font-semibold min-w-[140px] text-center tabular-nums">
              Week of {formatWeekRange(week.start, week.end)}
            </span>
            {offset === 0 && (
              <span className="text-[11px] font-semibold text-accent-ink bg-accent/10 rounded-full px-2.5 py-0.5">
                This week
              </span>
            )}
            <button
              type="button"
              onClick={() => setOffset((o) => o + 1)}
              className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
              aria-label="Next week"
            >
              ›
            </button>
          </div>
          <Link
            href={`/admin/reports?periodEnd=${period.end}`}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-accent-ink hover:bg-black/[0.03]"
            title={`2-week report: ${formatWeekRange(period.start, period.end)}`}
          >
            <ChartIcon className="h-4 w-4" />
            2-week report
          </Link>
        </div>
      </div>
      <TeamAvailabilityCards viewerId={viewerId} weekStart={week.start} weekEnd={week.end} />
    </div>
  );
}
