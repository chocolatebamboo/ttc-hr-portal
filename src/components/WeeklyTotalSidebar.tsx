import Link from "next/link";
import { formatMinutes } from "@/lib/time";
import { ChartIcon } from "@/components/icons";

export type WeekBucket = "approved" | "awaiting" | "returned" | "inProgress" | "notLogged";

const BUCKET_LABEL: Record<WeekBucket, string> = {
  approved: "Approved",
  awaiting: "Awaiting approval",
  returned: "Needs correction",
  inProgress: "In progress",
  notLogged: "Not logged",
};

// Same hues StatusPill already uses for these statuses (bg-emerald-100/text-emerald-800,
// bg-amber-100/text-amber-800, bg-rose-100/text-rose-800, bg-blue-100/text-blue-800), just as
// solid swatch dots instead of pill backgrounds — "Not logged" gets a plain dim dot since
// StatusPill's own MISSING_ENTRY style (bg-black/5) would be invisible on this card's dark
// background.
const BUCKET_DOT: Record<WeekBucket, string> = {
  approved: "bg-emerald-400",
  awaiting: "bg-amber-400",
  returned: "bg-rose-400",
  inProgress: "bg-blue-400",
  notLogged: "bg-white/35",
};

const BUCKET_ORDER: WeekBucket[] = ["approved", "awaiting", "returned", "inProgress", "notLogged"];

/**
 * Round 4 (CB, Oct 2026, pointing at the empty right-hand space on the team-member Timesheet
 * review page at desktop width, with the dark "Weekly total" bar circled at the bottom of a
 * narrow single-column day list): on desktop, this sidebar replaces that bottom bar — see
 * TimesheetTable.tsx's own `hideSummaryBar` prop, and ReviewTimesheetView.tsx for the grid
 * layout the two sit in side by side. On narrower screens (ReviewTimesheetView's grid collapses
 * to one column below `lg`), this card renders above the day list instead — see round fourteen
 * below.
 *
 * Oct 2026 (CB, screenshotting a team member's Timesheet with it circled out): dropped the small
 * explainer card underneath ("On desktop, this card stays in view...") — CB didn't want it there.
 * The sticky behavior itself is unchanged, just no longer narrated on the page.
 *
 * Round fourteen (CB, Oct 2026): three changes approved together as one design
 * (timesheet-period-accordion-v1 mockup) alongside ReviewTimesheetView's pay-period-accordion
 * rewrite:
 *  1. This card now totals the WHOLE pay period (both weeks), not just one calendar week — see
 *     ReviewTimesheetView's own periodMinutes/periodCounts, computed across both weeks' entries.
 *     Renamed weekLabel/totalMinutes's meaning accordingly (periodLabel, still totalMinutes).
 *  2. Added a "2-week report" row at the bottom (weekly-total-report-link-v1 mockup, CB: "can we
 *     have like a bottom section that shows like... the 2-week report... based off of that
 *     respective period" — "Yes, I love it."), linking to the exact period this card is showing,
 *     same `?periodEnd=` convention the Team Availability page's own "2-week report" button and
 *     the dashboard's report-ready banner already use.
 *  3. On mobile this whole card now renders ABOVE the day list instead of below it
 *     (weekly-total-mobile-order-v1 mockup, CB: "let's put that like on the mobile view at the
 *     top instead of the bottom so it reads well") — done via order-first/lg:order-2 on this
 *     card's grid item in ReviewTimesheetView, not inside this component itself, so desktop's
 *     side-by-side layout is completely unaffected.
 */
export default function WeeklyTotalSidebar({
  periodLabel,
  totalMinutes,
  counts,
  periodEnd,
}: {
  periodLabel: string;
  totalMinutes: number;
  counts: Partial<Record<WeekBucket, number>>;
  periodEnd: string;
}) {
  const rows = BUCKET_ORDER.filter((bucket) => (counts[bucket] ?? 0) > 0);

  return (
    <div className="lg:sticky lg:top-6 flex flex-col gap-4">
      <div className="rounded-2xl bg-neutral-900 text-white px-5 py-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/55">Pay period total</p>
        <p className="tabular-nums text-[34px] leading-none font-bold mt-2.5">{formatMinutes(totalMinutes)}</p>
        <p className="text-sm text-white/60 mt-1.5">{periodLabel}</p>

        {rows.length > 0 && (
          <>
            <div className="h-px bg-white/10 mt-4 mb-1" />
            <div className="divide-y divide-white/10">
              {rows.map((bucket) => (
                <div key={bucket} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2 text-white/80">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${BUCKET_DOT[bucket]}`} />
                    {BUCKET_LABEL[bucket]}
                  </span>
                  <span className="tabular-nums font-semibold">
                    {counts[bucket]} {counts[bucket] === 1 ? "day" : "days"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <Link
          href={`/admin/reports?periodEnd=${periodEnd}`}
          className="flex items-center gap-2 mt-3.5 pt-3 border-t border-white/10 text-sm font-semibold text-white"
        >
          <span className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <ChartIcon className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="flex-1 min-w-0">
            2-week report
            <span className="block font-normal text-xs text-white/50 mt-0.5">{periodLabel} pay period</span>
          </span>
          <span className="text-white/40 shrink-0">›</span>
        </Link>
      </div>
    </div>
  );
}
