"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TimeClockCard from "@/components/TimeClockCard";
import ScheduleSomeoneSheet from "@/components/ScheduleSomeoneSheet";

// Same tiny hook as TimeClockCard's own useLiveClock — kept as a local copy rather than a
// shared import so this component (and TimeClockCard) each stay self-contained; it's five
// lines and unlikely to drift.
function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The admin-only Home hero (CB, Sept 2026 redesign): "I love how the scheduling works right
 * now, but... for the admin view [I should] have an option to... schedule somebody else...
 * create their schedule for one of the team members and assign it to them... for the homepage
 * ... I like that the card has the time, but... I should see a dashboard of pretty much all the
 * different people that have the schedule right now." Replaces TimeClockCard as the Home
 * hero for admins (see dashboard/page.tsx's isAdmin branch) — keeps the same time/date face CB
 * called out by name, swaps the personal clock-in stat/button for admin-relevant numbers and a
 * "Schedule someone" action, and tucks personal clock-in behind a toggle rather than dropping
 * it, since not every admin is exempt from it (see clocksIn's own doc comment below).
 *
 * `scheduledToday`/`inProgress` come from the dashboard page's own listAdminShifts call for
 * today's date — this component has no fetch of its own for those, only for the "Schedule
 * someone" sheet's team-member list (ScheduleSomeoneSheet's own fetch). After a shift is
 * created, `router.refresh()` re-runs the server page (fresh stats, fresh "Who's working right
 * now" list below).
 *
 * Both stat tiles (Oct 2026, CB, circling them on a screenshot: "is it possible for us to...
 * click in these areas... and we see who's clocked in currently and... who's scheduled today"):
 * plain same-page `<a href="#...">` anchors, not a route change — "Scheduled today" jumps to
 * `#today-schedule` and "In progress" to `#working-now`, both ids TeamScheduleGlance renders
 * right below this hero on the same dashboard page (see that component's own doc comment on
 * exactly why those two ids cover exactly what these two numbers count, no more no less). No
 * new fetch, no new page — just scrolling to data that's already on screen. (Unrelated to the
 * `router.refresh()` just above, which is only about the "Schedule someone" sheet's own create
 * flow — that still patches neither stat in place, it just re-runs the server page.)
 *
 * `clocksIn` is Employee.clocksIn (see its own doc comment in prisma/schema.prisma) — CB:
 * "Shawn the founder will never clock in... Randall [won't either]... but Daijour we also need
 * the option to clock in as well." When false, the "Need to clock in yourself?" toggle and the
 * TimeClockCard it would expand are both left out entirely, not just hidden empty.
 */
export default function AdminHomeHero({
  variant,
  scheduledToday,
  inProgress,
  clocksIn,
}: {
  variant: "hero" | "default";
  scheduledToday: number;
  inProgress: number;
  clocksIn: boolean;
}) {
  const router = useRouter();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [clockExpanded, setClockExpanded] = useState(false);
  const now = useLiveClock();
  const liveDate = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const liveTime = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  function handleCreated() {
    setScheduleOpen(false);
    router.refresh();
  }

  function renderClockToggle(label: string, className: string) {
    if (!clocksIn) return null;
    return (
      <button type="button" onClick={() => setClockExpanded((v) => !v)} className={className}>
        {clockExpanded ? "▲ Hide clock in" : label}
      </button>
    );
  }

  const clockPanel = clocksIn && clockExpanded && (
    <div className="mt-3">
      <TimeClockCard variant="compact" onClose={() => setClockExpanded(false)} />
    </div>
  );

  const sheet = scheduleOpen && <ScheduleSomeoneSheet onClose={() => setScheduleOpen(false)} onCreated={handleCreated} />;

  if (variant === "hero") {
    return (
      <>
        <div className="rounded-3xl p-6 text-white shadow-lg" style={{ background: "var(--ttc-pink)" }}>
          <div className="mb-4">
            <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{liveTime}</p>
            <p className="text-sm font-medium text-white/75 mt-1.5">{liveDate}</p>
          </div>

          <div className="flex gap-2.5 mb-5">
            <a
              href="#today-schedule"
              className="flex-1 rounded-2xl bg-white/15 px-3.5 py-2.5 block active:bg-white/25 transition-colors"
            >
              <p className="text-2xl font-bold tabular-nums leading-none">{scheduledToday}</p>
              <p className="text-[11px] font-medium text-white/80 mt-1">Scheduled today</p>
            </a>
            <a
              href="#working-now"
              className="flex-1 rounded-2xl bg-white/15 px-3.5 py-2.5 block active:bg-white/25 transition-colors"
            >
              <p className="text-2xl font-bold tabular-nums leading-none">{inProgress}</p>
              <p className="text-[11px] font-medium text-white/80 mt-1">In progress</p>
            </a>
          </div>

          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 w-full min-h-[52px] rounded-full bg-white text-accent-ink font-semibold text-base"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Schedule someone
          </button>

          {renderClockToggle(
            "Need to clock in yourself? Tap here",
            "block w-full text-center mt-3 text-sm font-semibold text-white/80"
          )}
        </div>

        {clockPanel}
        {sheet}
      </>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <p className="text-3xl font-bold tabular-nums leading-none tracking-tight mb-1.5">{liveTime}</p>
            <p className="text-xs uppercase tracking-wide text-muted/60">{liveDate}</p>
          </div>
          <div className="flex gap-5">
            <a href="#today-schedule" className="text-right block hover:opacity-70 transition-opacity">
              <p className="text-lg font-semibold tabular-nums">{scheduledToday}</p>
              <p className="text-xs text-muted">Scheduled today</p>
            </a>
            <a href="#working-now" className="text-right block hover:opacity-70 transition-opacity">
              <p className="text-lg font-semibold tabular-nums">{inProgress}</p>
              <p className="text-xs text-muted">In progress</p>
            </a>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="btn-primary text-sm px-5 py-2.5"
          >
            + Schedule someone
          </button>
          {renderClockToggle("Need to clock in yourself?", "text-sm font-medium text-accent-ink hover:underline")}
        </div>
      </div>

      {clockPanel}
      {sheet}
    </>
  );
}
