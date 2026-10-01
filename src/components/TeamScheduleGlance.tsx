"use client";

// Oct 2026 (CB: "we shouldn't see like every upcoming date... that probably has a dropdown if
// they want to see the other dates... it's cluttering up the home page"): the Upcoming list below
// now collapses to the next few shifts with a "See more" toggle, which needs real client state —
// hence "use client" here now. Props (shifts/upcomingShifts) are still plain serializable DTOs
// from the dashboard/page.tsx Server Component, so this crosses the server/client boundary the
// same ordinary way ClockedInNowSection already does; it changes nothing about the RSC-boundary
// fix this file's initialsOf already has its own doc comment on below (initialsOf stays a local
// copy either way, "use client" or not).
import { Fragment, useState } from "react";
import Link from "next/link";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { formatTime12h, formatSlotDate } from "@/lib/availability-format";
import { dateKeyDaysFromNow } from "@/lib/time";
import type { AdminShiftDTO } from "@/types";

// Sept 2026 hotfix: this file has no "use client" directive (it renders directly inside
// dashboard/page.tsx, a Server Component) but was importing initialsOf as a plain function from
// TeamAvailabilityCards.tsx, which DOES have "use client". That's an RSC boundary violation —
// "Attempted to call initialsOf() from the server but initialsOf is on the client" — and it took
// down the whole Home dashboard for every admin the moment a build's chunking happened to expose
// it, rather than erroring at build time. Same small local copy MessagesInboxView.tsx's own
// initialsOf already uses for exactly this reason (see that file's own doc comment on the same
// choice) — kept local here too rather than moved to a shared lib, so nothing else importing it
// from TeamAvailabilityCards (a real client component, fine for its own client callers) needs to
// change.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

// Same small cycling palette as ScheduleSomeoneSheet's own picker avatars — kept as a local
// copy rather than a shared import (see that file's own doc comment on this same choice).
const AVATAR_COLORS = ["var(--ttc-pink)", "var(--ttc-blue)", "#7c5cff", "var(--ttc-pink-ink)", "var(--muted)"];
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** One date's worth of consecutive upcoming shifts — `groupUpcomingByDate` below relies on
 *  `upcomingShifts` already arriving sorted by date (listAdminShifts's own orderBy), so it only
 *  ever has to compare each shift against the group it's currently building, never re-sort. */
interface UpcomingDateGroup {
  date: string;
  shifts: AdminShiftDTO[];
}

function groupUpcomingByDate(upcomingShifts: AdminShiftDTO[]): UpcomingDateGroup[] {
  const groups: UpcomingDateGroup[] = [];
  for (const s of upcomingShifts) {
    const current = groups[groups.length - 1];
    if (current && current.date === s.date) current.shifts.push(s);
    else groups.push({ date: s.date, shifts: [s] });
  }
  return groups;
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
 *
 * `upcomingShifts` (CB, Sept 2026 follow-up, screenshotted the exact scenario): "just because
 * somebody isn't working today, I should be able to see the upcoming schedules, cleanly." Every
 * future shift from tomorrow onward (dashboard/page.tsx's own dateKeyDaysFromNow(1) with no
 * dateTo cap, CANCELLED/REASSIGNED already filtered out there), grouped here by date under its
 * own "Upcoming" header, shown whenever there's anything in that window, whether or not `shifts`
 * (today) is empty, so the empty-today message is never a dead end but today having people on
 * doesn't hide what's coming next either. No status pill on these rows (unlike `shifts` above):
 * every one of them is, by construction, still ahead, and the date-group header already says
 * which day.
 *
 * Collapsed-by-default (CB, Oct 2026, screenshotted a dashboard stretching from tomorrow to three
 * and a half weeks out with no cutoff): `upcomingShifts` itself still arrives uncapped from
 * dashboard/page.tsx exactly as before (nothing upstream changed), but only the first
 * UPCOMING_COLLAPSED_COUNT of them render until "See more" is tapped — confirmed via AskUserQuestion
 * ("Next 3, then 'See more'") rather than guessed. Counts individual shifts, not date-groups, so a
 * single busy day can still fill or exceed the collapsed view on its own.
 */
const UPCOMING_COLLAPSED_COUNT = 3;

export default function TeamScheduleGlance({
  shifts,
  upcomingShifts,
}: {
  shifts: AdminShiftDTO[];
  upcomingShifts: AdminShiftDTO[];
}) {
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const tomorrowKey = dateKeyDaysFromNow(1);
  const visibleUpcomingShifts = showAllUpcoming ? upcomingShifts : upcomingShifts.slice(0, UPCOMING_COLLAPSED_COUNT);
  const upcomingGroups = groupUpcomingByDate(visibleUpcomingShifts);
  const hiddenUpcomingCount = upcomingShifts.length - visibleUpcomingShifts.length;

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
                <p className="text-xs text-muted truncate">{s.employeeJobTitle}</p>
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

      {upcomingGroups.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-medium text-muted mb-2">Upcoming</h2>
          <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
            {upcomingGroups.map((group) => (
              <Fragment key={group.date}>
                <p className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted bg-black/[0.02]">
                  {group.date === tomorrowKey ? `Tomorrow · ${formatSlotDate(group.date)}` : formatSlotDate(group.date)}
                </p>
                {group.shifts.map((s) => (
                  <div key={s.id} className="flex items-center gap-2.5 px-4 py-3">
                    <span
                      className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                      style={{ background: colorFor(s.employeeId) }}
                    >
                      {initialsOf(s.employeeName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{s.employeeName}</p>
                      <p className="text-xs text-muted truncate">{s.employeeJobTitle}</p>
                    </div>
                    <p className="text-xs text-muted tabular-nums shrink-0">
                      {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
                    </p>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
          {hiddenUpcomingCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllUpcoming(true)}
              className="mt-2 text-xs font-medium text-accent-ink hover:underline"
            >
              See more ({hiddenUpcomingCount})
            </button>
          )}
          {showAllUpcoming && upcomingShifts.length > UPCOMING_COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setShowAllUpcoming(false)}
              className="mt-2 text-xs font-medium text-accent-ink hover:underline"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
