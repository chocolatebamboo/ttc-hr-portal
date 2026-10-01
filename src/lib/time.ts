import type { PtoType, TimeClockState, TimeEntryDTO } from "@/types";

export const PTO_TYPE_LABEL: Record<PtoType, string> = {
  VACATION: "Vacation",
  SICK: "Sick",
  PERSONAL: "Personal",
  OTHER_APPROVED_LEAVE: "Other Approved Leave",
};

/** Short form of PTO_TYPE_LABEL for the My Time calendar's day cells (src/components/
 *  TimesheetCalendar.tsx) — a 7-across grid cell, as narrow as ~45px on a small phone,
 *  can't fit "Other Approved Leave" or even "Vacation" legibly. */
export const PTO_TYPE_SHORT: Record<PtoType, string> = {
  VACATION: "Vac",
  SICK: "Sick",
  PERSONAL: "Pers",
  OTHER_APPROVED_LEAVE: "Leave",
};

export function formatDateRange(startIso: string, endIso: string): string {
  const s = new Date(`${startIso.slice(0, 10)}T00:00:00`);
  const e = new Date(`${endIso.slice(0, 10)}T00:00:00`);
  const startLabel = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (s.getTime() === e.getTime()) return startLabel;
  const endLabel = e.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

/** Today's date key in the employee's local sense — one entry per calendar day. */
export function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/** Same local sense as todayDateKey(), `days` calendar days from now — negative for the past.
 *  Added for the admin Home "Upcoming" glance (CB, Sept 2026: "just because somebody isn't
 *  working today, I should be able to see the upcoming schedules"), which needs both "tomorrow"
 *  (the window's start, and what labels its first group as "Tomorrow" rather than a bare date)
 *  and "a week out" (the window's end) — see dashboard/page.tsx and TeamScheduleGlance.tsx. */
export function dateKeyDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Working minutes = the sum of every CLOSED session's (clock out - clock in) — explicitly not
 * payroll: no rates, no overtime multiplier, no tax math — see brief §13. An open session (no
 * clockOut yet) contributes nothing until it closes. Null only when there are no sessions at
 * all for the day (nothing logged yet); once an entry exists this is always a real number,
 * 0 while its only session(s) are still open, so "Hours today" never looks broken mid-shift.
 */
export function computeTotalMinutes(sessions: { clockIn: Date; clockOut: Date | null }[]): number | null {
  if (sessions.length === 0) return null;
  let ms = 0;
  for (const s of sessions) {
    if (s.clockOut) ms += Math.max(0, s.clockOut.getTime() - s.clockIn.getTime());
  }
  return Math.round(ms / 60000);
}

/**
 * Derives which single action is valid right now — Clock In or Clock Out — from whether
 * today has an open session (a session with no clockOut yet). There's no "on lunch"/"after
 * lunch" state anymore: clocking out just closes the current session, and Clock In is offered
 * again immediately, any number of times a day.
 */
export function deriveClockState(entry: TimeEntryDTO | null): TimeClockState {
  if (!entry || entry.sessions.length === 0) return "BEFORE_WORK";
  return entry.sessions.some((s) => s.clockOut === null) ? "CLOCKED_IN" : "CLOCKED_OUT";
}

export function formatMinutes(totalMinutes: number | null): string {
  if (totalMinutes === null) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** A live, second-precision "how long has this session been open" readout — "H:MM:SS" (no
 *  leading zero on the hour, always two digits for minutes/seconds), e.g. "0:04:12", "1:32:07".
 *  Added alongside TimeClockCard's live-ticking clock-in timer (CB, Oct 2026: "were supposed to
 *  see the clock running when the team clocks in, that is very important" — raised after a
 *  report that a clock-out "didn't record at all," which live-database inspection showed had in
 *  fact recorded correctly; the real gap was that nothing visibly moved while clocked in).
 *  formatMinutes above only ever changes once a minute at best — exactly the "looks frozen"
 *  problem that request was about — so this is deliberately seconds-precision, meant to be paired
 *  with a 1-second tick (the same useLiveClock pattern TimeClockCard's time-of-day face already
 *  uses) so the number is unmistakably, visibly running rather than something you have to trust
 *  is updating. */
export function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Same value as formatMinutes, but to one decimal place with no "m" — for the Timesheet
 *  calendar's day cells (src/components/TimesheetCalendar.tsx), which are too narrow to fit
 *  "8h 00m" legibly at a glance the way the full detail panel below the grid can. */
export function formatHoursCompact(totalMinutes: number | null): string {
  if (totalMinutes === null) return "—";
  return `${(totalMinutes / 60).toFixed(1)}h`;
}

export function formatClockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** For prefilling an <input type="time">, in the browser's own local time. */
export function toTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Combines a "YYYY-MM-DD" day with an "HH:MM" <input type="time"> value into a local Date. */
export function combineDateAndTime(dateKey: string, timeValue: string): Date | null {
  if (!timeValue) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

/** TTC's own timezone, for the handful of SERVER-side comparisons that genuinely need to know
 *  what time it is right now for a real person at TTC, not just today's date. Originally lived
 *  only in src/lib/shift-reminders.ts ("Nothing else in this app has needed an organization
 *  timezone before this") — moved here once src/lib/shifts.ts (deriveShiftDisplayStatus) needed
 *  the exact same "what's today/right-now in Eastern, on a server that runs in UTC" logic a
 *  second time, rather than a second copy. CB confirmed Eastern for where TTC's shifts are. */
export const ORG_TIMEZONE = "America/New_York";

/** Phase 3 of the scheduling/attendance/task workflow rebuild (client spec, Sept 2026):
 *  "clock-in gated to scheduled shifts with a 15-minute window." How many minutes on either
 *  side of a shift's own startTime still count as clocking in "on time" — see
 *  resolveClockInShift in src/lib/time-actions.ts for where this is actually applied. Deliberately
 *  NOT applied to clocking out at all (CB confirmed: only clock-in is gated) — someone running
 *  over or leaving a little early is just recorded normally, same as before this phase. */
export const CLOCK_IN_WINDOW_MINUTES = 15;

/** Today's date key AND minutes-since-midnight, both resolved in ORG_TIMEZONE rather than
 *  whatever timezone this process happens to be running in (Render's servers run in UTC).
 *  Different from todayDateKey() above in exactly that way: todayDateKey() reflects wherever
 *  it's CALLED FROM (a real local date when called from the browser; the server's own UTC date
 *  when called from an API route) and is date-only, which is what date-boundary validation like
 *  submitAvailability's "today or later" check wants. This is for the opposite case — a
 *  server-side comparison against a specific wall-clock TIME, where "whatever timezone this
 *  process happens to run in" is the wrong answer. */
export function orgNow(): { dateKey: string; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ORG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  // hour12: false can render midnight as "24" in some engines rather than "00" — normalize.
  const minutesSinceMidnight = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return { dateKey, minutesSinceMidnight };
}

/** "HH:MM" -> minutes since midnight — the same conversion orgNow()'s minutesSinceMidnight is
 *  already in, so a stored startTime/endTime can be compared against it directly. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
