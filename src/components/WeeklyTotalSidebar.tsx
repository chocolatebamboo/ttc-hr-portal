import { formatMinutes } from "@/lib/time";

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
 * layout the two sit in side by side. Sticky so it stays in view while the day list scrolls,
 * matching the approved mockup. On narrower screens (ReviewTimesheetView's grid collapses to
 * one column below `lg`), this simply renders below the day list instead of beside it — never
 * hidden, since it's still the only place the weekly total shows once `hideSummaryBar` is set.
 */
export default function WeeklyTotalSidebar({
  weekLabel,
  totalMinutes,
  counts,
}: {
  weekLabel: string;
  totalMinutes: number;
  counts: Partial<Record<WeekBucket, number>>;
}) {
  const rows = BUCKET_ORDER.filter((bucket) => (counts[bucket] ?? 0) > 0);

  return (
    <div className="lg:sticky lg:top-6 flex flex-col gap-4">
      <div className="rounded-2xl bg-neutral-900 text-white px-5 py-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/55">Weekly total</p>
        <p className="tabular-nums text-[34px] leading-none font-bold mt-2.5">{formatMinutes(totalMinutes)}</p>
        <p className="text-sm text-white/60 mt-1.5">{weekLabel}</p>

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
      </div>

      <div className="hidden lg:block rounded-2xl border border-border bg-surface p-4 text-xs text-muted leading-relaxed">
        <span className="text-foreground font-semibold">On desktop</span>, this card stays in view as
        you scroll through the week&rsquo;s days — no more scrolling past every day to find the total
        at the bottom.
      </div>
    </div>
  );
}
