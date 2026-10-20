"use client";

import { useState } from "react";
import Link from "next/link";
import { getPayrollPeriod, getCurrentPayrollPeriodOffset, formatWeekRange } from "@/lib/week";
import TeamAvailabilityCards from "@/components/TeamAvailabilityCards";
import PayrollPeriodSwitcher from "@/components/PayrollPeriodSwitcher";
import { ChartIcon } from "@/components/icons";

/**
 * Oct 2026 (CB, on the Availability mockup's "Team availability requests" section: "I should see
 * an option to kind of look at the past archive ones... or being able to see what's in the
 * future as well"): the same week nav + "This week" badge Team Schedule and Attendance already
 * have — added here so this section reads the same way they do, instead of the old fixed
 * "pending + last 7 days decided, archive the rest" view. A Server Component page (AvailabilityPage)
 * can't own the offset state itself, so this small client wrapper does: it resolves the selected
 * range and hands the bounds down to TeamAvailabilityCards, which does the actual filtering (see
 * that component's own doc comment on its weekStart/weekEnd props) — the Approve/Deny/per-date
 * review machinery underneath is completely unchanged.
 *
 * Oct 2026, round two (CB: "I want to make sure that... the admin will be able to access on the
 * availability page, the two-week report for that specific... pay period"): a small "2-week
 * report" link next to the nav, deep-linking into Reports with `?periodEnd=`, same convention the
 * dashboard's report-ready banner (DashboardNotifications.tsx) already uses. No extra access
 * check needed here: every viewer who can reach this page at all (isAdmin or SUPERVISOR — see
 * AvailabilityAdminView's own `scope` doc comment) already satisfies canAccessReports
 * (src/lib/authorization.ts), which is the exact same isAdmin-or-SUPERVISOR check.
 *
 * Oct 2026, round three (CB, screenshotting Jennay Johnson's decided dates split across two
 * separate "Week of..." screens inside the same pay period: "I want everything to kind of be
 * reflected... in that two week intervals... we should see everyone's schedule holistic over
 * like the two weeks... it shouldn't be broken up until like... two different pink blocks"): this
 * used to page by a plain 7-day calendar week (getWeek), completely separate from the true 12-day
 * payroll period that "2-week report" linked out to — so a person's own requests could straddle
 * the boundary between two of this nav's own screens even while staying inside ONE pay period.
 * Swapped the whole offset/range model for the same PayrollPeriodSwitcher every other pay-period
 * view in this app already pages with (Reports, My Tasks, Logged Hours) — same "Current pay
 * period" badge, same 12-day span — so Decided/Pending here always shows a full pay period's
 * worth of requests in one list. TeamAvailabilityCards' own weekStart/weekEnd props are already
 * just generic inclusive date bounds (see that component's own doc comment), so passing a 12-day
 * payroll-period range instead of a 7-day calendar-week range needed no change there at all — the
 * list simply renders every chip in range, same flat flex-wrap it always has, so nothing visually
 * splits into separate blocks. The "2-week report" link is simpler now too: period.end IS the
 * selected range's own end, no more round-tripping through payrollPeriodOffsetForDate(week.start)
 * to recover it from a calendar week.
 */
export default function TeamAvailabilityWeekPanel({ viewerId }: { viewerId: string }) {
  const [offset, setOffset] = useState(getCurrentPayrollPeriodOffset);
  const period = getPayrollPeriod(offset);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-sm font-medium text-muted">Team availability requests</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <PayrollPeriodSwitcher offset={offset} onOffsetChange={setOffset} />
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
      <TeamAvailabilityCards viewerId={viewerId} weekStart={period.start} weekEnd={period.end} />
    </div>
  );
}
