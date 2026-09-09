import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { formatSlotDate } from "@/lib/availability-format";
import { formatMinutes } from "@/lib/time";

/** Hand-declared rather than importing Prisma's generated TimeEntry type — same convention
 *  src/lib/availability.ts's AvailabilityRow follows — narrowed to just the two fields this
 *  page's select actually reads. */
type WeekEntryRow = { workDate: Date; totalMinutes: number | null };

/**
 * CB, Sept 2026: "if we click on the blue this week... it should go into a page that's
 * similar to a widget layout or format that reads minimalistically but clean... similar to
 * the big clock." Same rolling last-7-days window the dashboard's "This week" stat tile
 * already sums (see dashboard/page.tsx's own doc comment on why it's rolling, not a calendar
 * week) — this just breaks that one number back out into a day-by-day read instead of
 * stopping at the total.
 */
export default async function ThisWeekPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  sevenDaysAgo.setUTCHours(0, 0, 0, 0);

  const entries: WeekEntryRow[] = await withRlsContext(
    { employeeId: employee.id, role: employee.role },
    async (tx) =>
      tx.timeEntry.findMany({
        where: { employeeId: employee.id, workDate: { gte: sevenDaysAgo } },
        select: { workDate: true, totalMinutes: true },
      })
  );

  const minutesByDate = new Map(entries.map((e) => [e.workDate.toISOString().slice(0, 10), e.totalMinutes ?? 0]));

  // Every day in the window gets a row, even one with nothing logged — a complete 7-day
  // strip reads as a real week at a glance, rather than a sparse list that only shows up on
  // days something happened.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo);
    d.setUTCDate(d.getUTCDate() + i);
    const dateKey = d.toISOString().slice(0, 10);
    return { dateKey, minutes: minutesByDate.get(dateKey) ?? 0 };
  });

  const totalMinutes = days.reduce((sum, d) => sum + d.minutes, 0);
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-md">
      <Link href="/dashboard" className="text-sm text-muted hover:text-accent-ink mb-3 inline-block">
        ← Home
      </Link>

      {/* Same big-number, solid-color "widget" face as TimeClockCard's hero variant — the
          look CB was pointing at when she said "similar to the big clock." */}
      <div className="rounded-3xl p-6 text-white shadow-lg" style={{ background: "var(--ttc-blue)" }}>
        <p className="text-xs uppercase tracking-wide text-white/70 mb-1">This week</p>
        <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{formatMinutes(totalMinutes)}</p>
        <p className="text-sm font-medium text-white/75 mt-2">
          {formatSlotDate(days[0].dateKey)} – {formatSlotDate(days[6].dateKey)}
        </p>
      </div>

      <div className="mt-5">
        <h2 className="text-sm font-medium text-muted mb-2">By day</h2>
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {days.map((d) => (
            <div key={d.dateKey} className="flex items-center justify-between px-4 py-3">
              <p className={`text-sm ${d.dateKey === todayKey ? "font-semibold" : ""}`}>
                {formatSlotDate(d.dateKey)}
                {d.dateKey === todayKey && <span className="text-muted font-normal"> · Today</span>}
              </p>
              <p className="text-sm tabular-nums text-muted">{formatMinutes(d.minutes)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
