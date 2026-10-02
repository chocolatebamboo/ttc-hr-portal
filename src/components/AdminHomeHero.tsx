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

/** One row inside a stat-tile menu — same visual shape as TeamScheduleGlance's own
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
 * The floating "who's on this tile" menu (Oct 2026 redo — CB rejected the first version of this
 * feature, a same-page scroll-jump: "It's not functioning right it's supposed to function like
 * you can see the names what you click on it like it's on menu," and asked to see a mockup
 * before anything shipped again — approved, "Yes I like that," before this was written). Tapping
 * a stat tile now pops this panel right under it, showing the real people behind the number,
 * instead of jumping to TeamScheduleGlance further down the page.
 *
 * `align`: which edge of the tile the panel hangs from — "start" (left-anchored, extends right)
 * for the first/leftmost tile, "end" (right-anchored, extends left) for the second/rightmost
 * one. Both tiles sharing one row means a fixed-width panel wider than either tile will overhang
 * its own tile either way; anchoring each to the OUTER edge of its tile (left edge for the first
 * tile, right edge for the second) keeps the panel inside the hero card's own bounds instead of
 * running off the side of the screen on a narrow phone — the opposite choice (anchoring both to
 * the same side) would push the second tile's panel past the right edge of the hero on anything
 * narrower than about a tablet.
 */
function StatMenu({
  title,
  rows,
  align,
  onClose,
}: {
  title: string;
  rows: AdminShiftDTO[];
  align: "start" | "end";
  onClose: () => void;
}) {
  return (
    <>
      {/* Tapping anywhere outside the panel closes it (CB's mockup caption: "Tapping outside...
          closes it") — a full-viewport invisible layer is simpler and more reliable here than a
          document click-outside listener, and needs no cleanup/ref wiring. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        className={`absolute top-[calc(100%+10px)] ${align === "start" ? "left-0" : "right-0"} z-30 w-72 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-border bg-surface shadow-xl overflow-hidden animate-in`}
      >
        <div className="px-3.5 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {title}
        </div>
        <div className="divide-y divide-border max-h-72 overflow-y-auto">
          {rows.map((s) => (
            <MenuRow key={s.id} s={s} onNavigate={onClose} />
          ))}
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
 * pre-computed counts, so both the stat numbers AND the two tiles' dropdown menus come from one
 * fetch with no risk of the tile's number and its menu's contents ever disagreeing.
 * `scheduledToday`/`inProgressShifts` below are derived from it, not fetched separately.
 *
 * Both stat tiles (Oct 2026, CB, circling them on a screenshot: "is it possible for us to...
 * click in these areas... and we see who's clocked in currently and... who's scheduled today")
 * are buttons that open a StatMenu (above) listing the actual people behind the number — a
 * same-page scroll-jump was the first attempt at this and CB rejected it (see StatMenu's own
 * doc comment); this version opens no new page and makes no new fetch, just reads from
 * `todaysShifts` already in hand. A tile with nothing behind it (zero today, or nobody currently
 * in progress) renders as a plain non-interactive block instead of a button — nothing to show in
 * a menu, so nothing to tap.
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
  const [openMenu, setOpenMenu] = useState<"scheduled" | "progress" | null>(null);
  const now = useLiveClock();
  const liveDate = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const liveTime = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const inProgressShifts = todaysShifts.filter((s) => s.displayStatus === "IN_PROGRESS");
  const scheduledToday = todaysShifts.length;
  const inProgress = inProgressShifts.length;

  // Escape closes the open menu same as tapping outside it — cheap to support, standard for any
  // floating panel.
  useEffect(() => {
    if (!openMenu) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openMenu]);

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

  if (variant === "hero") {
    return (
      <>
        <div className="rounded-3xl p-6 text-white shadow-lg relative" style={{ background: "var(--ttc-pink)" }}>
          <div className="mb-4">
            <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{liveTime}</p>
            <p className="text-sm font-medium text-white/75 mt-1.5">{liveDate}</p>
          </div>

          <div className="flex gap-2.5 mb-5">
            <div className="relative flex-1">
              {scheduledToday > 0 ? (
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === "scheduled" ? null : "scheduled"))}
                  className={`block w-full text-left rounded-2xl px-3.5 py-2.5 transition-colors ${
                    openMenu === "scheduled" ? "bg-white/28 outline outline-2 outline-white/60" : "bg-white/15 active:bg-white/25"
                  }`}
                >
                  <p className="text-2xl font-bold tabular-nums leading-none">{scheduledToday}</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1 flex items-center gap-1">
                    Scheduled today {chevron(openMenu === "scheduled")}
                  </p>
                </button>
              ) : (
                <div className="rounded-2xl bg-white/15 px-3.5 py-2.5">
                  <p className="text-2xl font-bold tabular-nums leading-none">0</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1">Scheduled today</p>
                </div>
              )}
              {openMenu === "scheduled" && (
                <StatMenu title="Scheduled today" rows={todaysShifts} align="start" onClose={() => setOpenMenu(null)} />
              )}
            </div>

            <div className="relative flex-1">
              {inProgress > 0 ? (
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === "progress" ? null : "progress"))}
                  className={`block w-full text-left rounded-2xl px-3.5 py-2.5 transition-colors ${
                    openMenu === "progress" ? "bg-white/28 outline outline-2 outline-white/60" : "bg-white/15 active:bg-white/25"
                  }`}
                >
                  <p className="text-2xl font-bold tabular-nums leading-none">{inProgress}</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1 flex items-center gap-1">
                    In progress {chevron(openMenu === "progress")}
                  </p>
                </button>
              ) : (
                <div className="rounded-2xl bg-white/15 px-3.5 py-2.5">
                  <p className="text-2xl font-bold tabular-nums leading-none">0</p>
                  <p className="text-[11px] font-medium text-white/80 mt-1">In progress</p>
                </div>
              )}
              {openMenu === "progress" && (
                <StatMenu title="Working right now" rows={inProgressShifts} align="end" onClose={() => setOpenMenu(null)} />
              )}
            </div>
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
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm relative">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <p className="text-3xl font-bold tabular-nums leading-none tracking-tight mb-1.5">{liveTime}</p>
            <p className="text-xs uppercase tracking-wide text-muted/60">{liveDate}</p>
          </div>
          <div className="flex gap-5">
            <div className="relative">
              {scheduledToday > 0 ? (
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === "scheduled" ? null : "scheduled"))}
                  className="text-right block hover:opacity-70 transition-opacity"
                >
                  <p className="text-lg font-semibold tabular-nums">{scheduledToday}</p>
                  <p className="text-xs text-muted flex items-center gap-1 justify-end">
                    Scheduled today {chevron(openMenu === "scheduled")}
                  </p>
                </button>
              ) : (
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">0</p>
                  <p className="text-xs text-muted">Scheduled today</p>
                </div>
              )}
              {openMenu === "scheduled" && (
                <StatMenu title="Scheduled today" rows={todaysShifts} align="start" onClose={() => setOpenMenu(null)} />
              )}
            </div>

            <div className="relative">
              {inProgress > 0 ? (
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === "progress" ? null : "progress"))}
                  className="text-right block hover:opacity-70 transition-opacity"
                >
                  <p className="text-lg font-semibold tabular-nums">{inProgress}</p>
                  <p className="text-xs text-muted flex items-center gap-1 justify-end">
                    In progress {chevron(openMenu === "progress")}
                  </p>
                </button>
              ) : (
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">0</p>
                  <p className="text-xs text-muted">In progress</p>
                </div>
              )}
              {openMenu === "progress" && (
                <StatMenu title="Working right now" rows={inProgressShifts} align="end" onClose={() => setOpenMenu(null)} />
              )}
            </div>
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
