// Oct 2026 (CB: "I shouldn't see the same name come up multiple times... it should be under its
// respective name... and then when we click it we can see that person's full schedule down the
// line"): the Upcoming list below no longer needs any client state of its own — no more in-place
// "See more" toggle (see UPCOMING_COLLAPSED_COUNT's own doc comment) — so this file drops the
// "use client" directive it picked up for that toggle and goes back to rendering straight from
// dashboard/page.tsx, a Server Component, the same way it did before that toggle existed.
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

/** One employee's own upcoming shifts, collapsed to a single row — `groupUpcomingByEmployee`
 *  below relies on `upcomingShifts` already arriving sorted by date (listAdminShifts's own
 *  orderBy), so the first shift it sees for a given employee is always that employee's own
 *  soonest one, with no re-sorting needed. */
interface UpcomingEmployeeGroup {
  employeeId: string;
  employeeName: string;
  employeeJobTitle: string;
  /** This employee's own soonest upcoming shift — what the row's date/time line shows. */
  nextShift: AdminShiftDTO;
  /** How many upcoming shifts this employee has in total, nextShift included. */
  count: number;
}

// Oct 2026 (CB, screenshotted the Upcoming list showing "Haile Eugene" as a separate row for
// every date she had a shift on): "I shouldn't see the same name come up multiple times... it
// should be under its respective name... Haley should show up once." One row per employee
// instead of one row per shift occurrence — the date-grouped version this replaced
// (groupUpcomingByDate) read naturally for "who's on which day" but fell apart the moment one
// person had several upcoming shifts, which is exactly the common case this list exists for.
function groupUpcomingByEmployee(upcomingShifts: AdminShiftDTO[]): UpcomingEmployeeGroup[] {
  const order: string[] = [];
  const byEmployee = new Map<string, AdminShiftDTO[]>();
  for (const s of upcomingShifts) {
    if (!byEmployee.has(s.employeeId)) {
      byEmployee.set(s.employeeId, []);
      order.push(s.employeeId);
    }
    byEmployee.get(s.employeeId)!.push(s);
  }
  return order.map((employeeId) => {
    const shiftsForEmployee = byEmployee.get(employeeId)!;
    const nextShift = shiftsForEmployee[0];
    return {
      employeeId,
      employeeName: nextShift.employeeName,
      employeeJobTitle: nextShift.employeeJobTitle,
      nextShift,
      count: shiftsForEmployee.length,
    };
  });
}

/**
 * "Who's working right now" (CB, Sept 2026, admin Home redesign): "I should see a dashboard of
 * pretty much all the different people that have the schedule right now in a clean way... just
 * so I could get like a glance of who is supposed to be working right now." `shifts` is every
 * shift for TODAY only (the dashboard page's own listAdminShifts call with dateFrom/dateTo both
 * set to today).
 *
 * Split into two groups (Oct 2026, CB, screenshotting this exact header sitting above two
 * "Upcoming"-pilled rows: "when you say who's working right now... I would interpret it to be
 * like they're literally working right now, but that's not the case here"): "Who's working
 * right now" now only ever holds shifts whose displayStatus is actually IN_PROGRESS — their
 * scheduled window has started and hasn't ended yet, so the header is true at a glance instead
 * of needing the status pill to contradict it. Everything else from today (UPCOMING, already
 * COMPLETED, MISSED/no-clock-in, or mid-request) renders underneath as a separate "Today"
 * group instead — deliberately not "Later today," since a completed or missed shift from this
 * morning isn't "later" either; the status pill on each row still carries that nuance, same as
 * before. Nothing from `shifts` is dropped, just regrouped — see rightNowShifts/restOfToday
 * below. "Full schedule" still links to the existing Team Schedule page for anything past a
 * same-day glance (filtering by person/department, cancel/reassign, requests) — this list
 * doesn't duplicate any of that; it now lives on whichever of the two sections renders first so
 * it never appears twice.
 *
 * `upcomingShifts` (CB, Sept 2026 follow-up, screenshotted the exact scenario): "just because
 * somebody isn't working today, I should be able to see the upcoming schedules, cleanly." Every
 * future shift from tomorrow onward (dashboard/page.tsx's own dateKeyDaysFromNow(1) with no
 * dateTo cap, CANCELLED/REASSIGNED already filtered out there), grouped here by EMPLOYEE (see
 * groupUpcomingByEmployee above) under its own "Upcoming" header, shown whenever there's
 * anything in that window, whether or not `shifts` (today) is empty, so the empty-today message
 * is never a dead end but today having people on doesn't hide what's coming next either.
 *
 * Capped at UPCOMING_COLLAPSED_COUNT employees (CB, Oct 2026: "on the home page probably should
 * show like four max"), with a "See all" link to the full Team Schedule page instead of the old
 * in-place "See more" toggle (CB, same pass: "I think it would be appropriate to go into that
 * other page" rather than expanding the same list) — see the render below for exactly which
 * link. `upcomingShifts` itself still arrives uncapped from dashboard/page.tsx exactly as
 * before; only the rendered employee-row count is capped here.
 *
 * Each `shifts` row still links to `/team/${employeeId}` (CB, earlier round: "I should be able
 * to click on the team member and see information relating to that team member there") — the
 * review-employee page (timesheet, time off, availability, notes). Each `upcomingShifts` row
 * instead links to `/team/schedule?employeeId=${employeeId}` (CB, this round: "when we click it
 * we can see that person's full schedule down the line") — the existing Team Schedule page,
 * pre-filtered to just this person via the URL param it now reads on load (see
 * TeamScheduleView's own doc comment), rather than duplicating a second shift list on the
 * review page. Both are safe for whoever is actually looking at this widget: it only ever
 * renders for a caller canSeeAdminHomeDashboard already lets see it (dashboard/page.tsx), i.e.
 * an admin (every employeeId here is fair game) or a supervisor (dashboard/page.tsx's own
 * listAdminShifts call already narrows `shifts`/`upcomingShifts` to that supervisor's own direct
 * reports) — exactly the same set both /team/[employeeId] and /team/schedule already gate on.
 * No new access is being opened up here, just a path to it.
 *
 * "Who's working right now" hides entirely — header, Full schedule link, and body — when `shifts`
 * is empty (Oct 2026, CB circling that exact header+"Nobody's scheduled today yet" pairing: "if
 * there isn't anything currently in the field then we shouldn't see it at all cause its
 * cluttering the home page"). Upcoming is unaffected by that rule — it already only renders when
 * it has something to show (upcomingGroups.length > 0 below) — so a quiet today never hides what's
 * scheduled next. If both are empty the whole widget renders nothing, same "no stray empty
 * section" call ClockedInNowSection/TimeOffSection/AvailabilityStatusSection now make too.
 */
const UPCOMING_COLLAPSED_COUNT = 4;

/** One row of either the "Who's working right now" or "Today" list — same visual shape either
 *  way, just a different source array, so this is shared instead of copy-pasted twice. */
function ShiftGlanceRow({ s }: { s: AdminShiftDTO }) {
  return (
    <Link href={`/team/${s.employeeId}`} className="flex items-center gap-2.5 px-4 py-3 hover:bg-black/[0.02]">
      {s.employeeAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- public storage URL
        <img
          src={s.employeeAvatarUrl}
          alt=""
          className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
        />
      ) : (
        <span
          className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
          style={{ background: colorFor(s.employeeId) }}
        >
          {initialsOf(s.employeeName)}
        </span>
      )}
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
    </Link>
  );
}

export default function TeamScheduleGlance({
  shifts,
  upcomingShifts,
  className,
}: {
  shifts: AdminShiftDTO[];
  upcomingShifts: AdminShiftDTO[];
  className?: string;
}) {
  const tomorrowKey = dateKeyDaysFromNow(1);
  const upcomingGroups = groupUpcomingByEmployee(upcomingShifts);
  const visibleUpcomingGroups = upcomingGroups.slice(0, UPCOMING_COLLAPSED_COUNT);
  const hiddenUpcomingEmployeeCount = upcomingGroups.length - visibleUpcomingGroups.length;

  const rightNowShifts = shifts.filter((s) => s.displayStatus === "IN_PROGRESS");
  const restOfToday = shifts.filter((s) => s.displayStatus !== "IN_PROGRESS");
  // The Full schedule link only ever appears once — on whichever of the two today-sections
  // renders first — rather than once per section.
  const fullScheduleLink = (
    <Link href="/team/schedule" className="text-xs font-medium text-accent-ink hover:underline shrink-0">
      Full schedule →
    </Link>
  );

  if (shifts.length === 0 && upcomingGroups.length === 0) return null;

  // Oct 2026 (CB, circling "Scheduled today"/"In progress" on AdminHomeHero's own stat tiles:
  // "is it possible for us to... click in these areas... and we see who's clocked in currently
  // and... who's scheduled today"): a first attempt made these two ids same-page scroll targets
  // for the stat tiles above; CB rejected that ("it's supposed to function like you can see the
  // names... like it's on menu") and asked for an actual names-in-a-menu popover instead, which
  // is what AdminHomeHero's own tiles now open directly from the same `todaysShifts` array this
  // component renders — see that component's own doc comment. No more scroll-jump here, so this
  // section no longer needs its own anchor ids.
  return (
    <div className={className}>
      {rightNowShifts.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-medium text-muted">Who&apos;s working right now</h2>
            {fullScheduleLink}
          </div>
          <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
            {rightNowShifts.map((s) => (
              <ShiftGlanceRow key={s.id} s={s} />
            ))}
          </div>
        </div>
      )}

      {restOfToday.length > 0 && (
        <div className={rightNowShifts.length > 0 ? "mt-4" : ""}>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-medium text-muted">Today</h2>
            {rightNowShifts.length === 0 && fullScheduleLink}
          </div>
          <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
            {restOfToday.map((s) => (
              <ShiftGlanceRow key={s.id} s={s} />
            ))}
          </div>
        </div>
      )}

      {upcomingGroups.length > 0 && (
        <div className={shifts.length > 0 ? "mt-4" : ""}>
          <h2 className="text-sm font-medium text-muted mb-2">Upcoming</h2>
          <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
            {visibleUpcomingGroups.map((g) => (
              <Link
                key={g.employeeId}
                href={`/team/schedule?employeeId=${g.employeeId}`}
                className="flex items-center gap-2.5 px-4 py-3 hover:bg-black/[0.02]"
              >
                {g.nextShift.employeeAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                  <img
                    src={g.nextShift.employeeAvatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
                  />
                ) : (
                  <span
                    className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                    style={{ background: colorFor(g.employeeId) }}
                  >
                    {initialsOf(g.employeeName)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{g.employeeName}</p>
                  <p className="text-xs text-muted truncate">
                    {g.nextShift.date === tomorrowKey ? "Tomorrow" : formatSlotDate(g.nextShift.date)} ·{" "}
                    {formatTime12h(g.nextShift.startTime)} – {formatTime12h(g.nextShift.endTime)}
                  </p>
                </div>
                {g.count > 1 && (
                  <span className="text-xs font-medium text-muted shrink-0">+{g.count - 1} more</span>
                )}
              </Link>
            ))}
          </div>
          {hiddenUpcomingEmployeeCount > 0 && (
            <Link
              href={`/team/schedule?dateFrom=${tomorrowKey}`}
              className="mt-2 inline-block text-xs font-medium text-accent-ink hover:underline"
            >
              See all upcoming ({upcomingGroups.length}) →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
