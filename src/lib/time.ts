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
