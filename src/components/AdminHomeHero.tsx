"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TimeClockCard from "@/components/TimeClockCard";
import ScheduleSomeoneSheet from "@/components/ScheduleSomeoneSheet";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { formatTime12h } from "@/lib/availability-format";
import type { AdminShiftDTO } from "@/types";

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

// Same small local copy TeamScheduleGlance/MessagesInboxView each keep for exactly the same
// reason (see TeamScheduleGlance's own doc comment on this) — not shared, since this file is a
// Client Component and the point of each copy is to not depend on another file's own boundary.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}
const AVATAR_COLORS = ["var(--ttc-pink)", "var(--ttc-blue)", "#7c5cff", "var(--ttc-pink-ink)", "var(--muted)"];
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** One row inside the stat-tile menu — same visual shape as TeamScheduleGlance's own
 *  ShiftGlanceRow (avatar, name, job title, time, status pill), kept as its own local copy here
 *  rather than imported since ShiftGlanceRow isn't exported from that file (it's a same-page
 *  helper there, same as initialsOf/colorFor above). */
function MenuRow({ s, onNavigate }: { s: AdminShiftDTO; onNavigate: () => void }) {
  return (
    <Link
      href={`/team/${s.employeeId}`}
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-black/[0.02]"
    >
      {s.employeeAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- public storage URL
        <img
          src={s.employeeAvatarUrl}
          alt=""
          className="h-8 w-8 rounded-full object-cover border border-border shrink-0"
        />
      ) : (
        <span
          className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
          style={{ background: colorFor(s.employeeId) }}
        >
          {initialsOf(s.employeeName)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold truncate leading-tight">{s.employeeName}</p>
        <p className="text-[11.5px] text-muted truncate leading-tight">{s.employeeJobTitle}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10.5px] text-muted tabular-nums mb-1">
          {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
        </p>
        <ShiftStatusPill status={s.displayStatus} />
      </div>
    </Link>
  );
}

/**
 * The "today's schedule" menu (Oct 2026 redo — CB rejected the first version of this feature, a
 * same-page scroll-jump: "It's not functioning right it's supposed to function like you can see
 * the names what you click on it like it's on menu," and asked to see a mockup before anything
 * shipped again — approved, "Yes I like that," before this was built). Tapping either stat tile
 * reveals this one panel, showing the real people behind today's numbers, instead of jumping to
 * TeamScheduleGlance further down the page.
 *
 * ONE combined panel, not two separate ones (CB, immediate follow-up after the first version of
 * this went out: "we should see the schedule today as well" — confirmed via a follow-up
 * question: "Either tile opens the same panel: 'Working right now' at the top, then everyone
 * else scheduled today underneath. One tap shows the whole picture"). So both tiles open this
 * exact component with the exact same `shifts` (todaysShifts, unfiltered) — which tile you
 * tapped doesn't change what's inside it. Split into the same two groups, with the same two
 * labels, as TeamScheduleGlance's own "Who's working right now"/"Today" split just below this
 * hero on the page (rightNowShifts/restOfToday there) — deliberately the same grouping and the
 * same words, so this panel and that section never disagree about who's in which bucket.
 *
 * Oct 2026 (CB, on a screenshot of this exact panel open: "it's not dropping down in a way that
 * is like directly above the schedule someone and I needed to be cleanly in response to that" —
 * confirmed against a before/after mockup): this used to render `absolute`, floating on top of
 * whatever came after it in the layout ("Schedule someone", and TeamScheduleGlance further down)
 * instead of making room for itself. It's now a plain in-flow block — see the two render
 * branches below, where it sits right after the tile row and before "Schedule someone," pushing
 * that button (and everything after it) down instead of covering it. Dropped the old `align`
 * prop along with the absolute positioning it existed for — a full-width in-flow panel doesn't
 * need to pick which tile's edge to hang off of.
 */
function StatMenu({ shifts, onClose }: { shifts: AdminShiftDTO[]; onClose: () => void }) {
  const rightNowShifts = shifts.filter((s) => s.displayStatus === "IN_PROGRESS");
  const restOfToday = shifts.filter((s) => s.displayStatus !== "IN_PROGRESS");

  return (
    <>
      {/* Tapping anywhere outside the panel closes it (CB's mockup caption: "Tapping outside...
          closes it") — a full-viewport invisible layer is simpler and more reliable here than a
          document click-outside listener, and needs no cleanup/ref wiring. Still a `fixed`
          overlay even though the panel itself is no longer `absolute` — this is about catching
          taps anywhere on the page, not about the panel's own position. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div className="relative z-30 rounded-2xl border border-border bg-surface shadow-xl overflow-hidden animate-in">
        <div className="max-h-80 overflow-y-auto">
          {rightNowShifts.length > 0 && (
            <div>
              <div className="px-3.5 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Working right now
              </div>
              <div className="divide-y divide-border">
                {rightNowShifts.map((s) => (
                  <MenuRow key={s.id} s={s} onNavigate={onClose} />
                ))}
              </div>
            </div>
          )}
          {restOfToday.length > 0 && (
            <div>
              <div className="px-3.5 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Today
              </div>
              <div className="divide-y divide-border">
                {restOfToday.map((s) => (
                  <MenuRow key={s.id} s={s} onNavigate={onClose} />
                ))}
              </div>
            </div>
          )}
        </div>
        <Link
          href="/team/schedule"
          onClick={onClose}
          className="block px-3.5 py-2.5 text-xs font-semibold text-accent-ink hover:underline border-t border-border bg-[color-mix(in_srgb,var(--ttc-pink)_4%,var(--surface))]"
        >
          Full schedule →
        </Link>
      </div>
    </>
  );
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
 * `todaysShifts` is dashboard/page.tsx's own `todaysShifts` — every shift for today, the exact
 * same array TeamScheduleGlance renders below this hero — passed through whole rather than as
 * pre-computed counts, so both the stat numbers AND the stat-tile menu's rows come from one
 * fetch with no risk of the tile's number and the menu's contents ever disagreeing.
 * `scheduledToday`/`inProgress` below are derived from it, not fetched separately.
 *
 * Both stat tiles (Oct 2026, CB, circling them on a screenshot: "is it possible for us to...
 * click in these areas... and we see who's clocked in currently and... who's scheduled today")
 * open the SAME StatMenu (above) — see that component's own doc comment for why this is one
 * combined panel rather than two separate ones; `openFrom` tracks which tile was tapped only to
 * decide its own outline/highlight state, not what's inside the panel. Opens no new page and
 * makes no new fetch, just reads from `todaysShifts` already in hand. Both tiles are
 * non-interactive (plain block, no button, no chevron) when `todaysShifts` is empty entirely —
 * nothing to show in the menu either way, so nothing to tap — but stay tappable even when that
 * specific tile's own number is 0, since the combined menu can still have something in its other
 * section (e.g. "In progress" reads 0 but there's still a "Today" list to see).
 *
 * `clocksIn` is Employee.clocksIn (see its own doc comment in prisma/schema.prisma) — CB:
 * "Shawn the founder will never clock in... Randall [won't either]... but Daijour we also need
 * the option to clock in as well." When false, the "Need to clock in yourself?" toggle and the
 * TimeClockCard it would expand are both left out entirely, not just hidden empty.
 */
export default function AdminHomeHero({
  variant,
  todaysShifts,
  clocksIn,
}: {
  variant: "hero" | "default";
  todaysShifts: AdminShiftDTO[];
  clocksIn: boolean;
}) {
  const router = useRouter();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [clockExpanded, setClockExpanded] = useState(false);
  const [openFrom, setOpenFrom] = useState<"scheduled" | "progress" | null>(null);
  const now = useLiveClock();
  const liveDate = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const liveTime = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const scheduledToday = todaysShifts.length;
  const inProgress = todaysShifts.filter((s) => s.displayStatus === "IN_PROGRESS").length;
  const hasAnything = scheduledToday > 0;

  // Escape closes the open menu same as tapping outside it — cheap to support, standard for any
  // floating panel.
  useEffect(() => {
    if (!openFrom) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenFrom(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openFrom]);

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

  const chevron = (open: boolean) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  function toggle(from: "scheduled" | "progress") {
    setOpenFrom((cur) => (cur === from ? null : from));
  }

  if (variant === "hero") {
    return (
      <>
        <div className="rounded-3xl p-6 text-white shadow-lg relative" style={{ background: "var(--ttc-pink)" }}>
          <div className="mb-4">
            <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{liveTime}</p>
            <p className="text-sm font-medium text-white/75 mt-1.5">{liveDate}</p>
          </div>

          <div className={`flex gap-2.5 ${openFrom ? "mb-3" : "mb-5"}`}>
            <div className="flex-1">
              {hasAnything ? (
                <button
                  type="button"
                  onClick={() => toggle("scheduled")}
                  className={`block w-full text-left rounded-2xl px-3.5 py-2.5 transition-colors ${
                    openFrom === "scheduled" ? "bg-white/28 outline outline-2 outline-white/60" : "bg-white/15 active:bg-white/25"
                  }`}
                >
                  <p className="text-2xl font-bold tabular-nums leading-none">{scheduledToday}</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1 flex items-center gap-1">
                    Scheduled today {chevron(openFrom === "scheduled")}
                  </p>
                </button>
              ) : (
                <div className="rounded-2xl bg-white/15 px-3.5 py-2.5">
                  <p className="text-2xl font-bold tabular-nums leading-none">0</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1">Scheduled today</p>
                </div>
              )}
            </div>

            <div className="flex-1">
              {hasAnything ? (
                <button
                  type="button"
                  onClick={() => toggle("progress")}
                  className={`block w-full text-left rounded-2xl px-3.5 py-2.5 transition-colors ${
                    openFrom === "progress" ? "bg-white/28 outline outline-2 outline-white/60" : "bg-white/15 active:bg-white/25"
                  }`}
                >
                  <p className="text-2xl font-bold tabular-nums leading-none">{inProgress}</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1 flex items-center gap-1">
                    In progress {chevron(openFrom === "progress")}
                  </p>
                </button>
              ) : (
                <div className="rounded-2xl bg-white/15 px-3.5 py-2.5">
                  <p className="text-2xl font-bold tabular-nums leading-none">0</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1">In progress</p>
                </div>
              )}
            </div>
          </div>

          {/* In-flow, not absolute — see StatMenu's own doc comment. Sits right between the
              tiles and "Schedule someone," pushing that button (and everything below it) down
              instead of floating on top of it. */}
          {openFrom && (
            <div className="mb-5">
              <StatMenu shifts={todaysShifts} onClose={() => setOpenFrom(null)} />
            </div>
          )}

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
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm relative">
        <div className={`flex items-start justify-between gap-4 flex-wrap ${openFrom ? "mb-3" : "mb-5"}`}>
          <div>
            <p className="text-3xl font-bold tabular-nums leading-none tracking-tight mb-1.5">{liveTime}</p>
            <p className="text-xs uppercase tracking-wide text-muted/60">{liveDate}</p>
          </div>
          <div className="flex gap-5">
            <div>
              {hasAnything ? (
                <button
                  type="button"
                  onClick={() => toggle("scheduled")}
                  className="text-right block hover:opacity-70 transition-opacity"
                >
                  <p className="text-lg font-semibold tabular-nums">{scheduledToday}</p>
                  <p className="text-xs text-muted flex items-center gap-1 justify-end">
                    Scheduled today {chevron(openFrom === "scheduled")}
                  </p>
                </button>
              ) : (
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">0</p>
                  <p className="text-xs text-muted">Scheduled today</p>
                </div>
              )}
            </div>

            <div>
              {hasAnything ? (
                <button
                  type="button"
                  onClick={() => toggle("progress")}
                  className="text-right block hover:opacity-70 transition-opacity"
                >
                  <p className="text-lg font-semibold tabular-nums">{inProgress}</p>
                  <p className="text-xs text-muted flex items-center gap-1 justify-end">
                    In progress {chevron(openFrom === "progress")}
                  </p>
                </button>
              ) : (
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">0</p>
                  <p className="text-xs text-muted">In progress</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* In-flow, not absolute — see StatMenu's own doc comment. Sits between the header row
            and the "Schedule someone" row, pushing the latter down instead of floating on top
            of it. */}
        {openFrom && (
          <div className="mb-5">
            <StatMenu shifts={todaysShifts} onClose={() => setOpenFrom(null)} />
          </div>
        )}

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
