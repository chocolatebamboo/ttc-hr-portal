import type { PtoType, TimeClockState, TimeEntryDTO } from "@/types";

export const PTO_TYPE_LABEL: Record<PtoType, string> = {
  VACATION: "Vacation",
  SICK: "Sick",
  PERSONAL: "Personal",
  OTHER_APPROVED_LEAVE: "Other Approved Leave",
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
 * Working minutes = (clock out - clock in) - (lunch end - lunch start). Explicitly not
 * payroll: no rates, no overtime multiplier, no tax math — see brief §13. Returns null
 * until the day is complete (clockIn and clockOut both set) so partial days never show a
 * misleadingly-final number.
 */
export function computeTotalMinutes(entry: {
  clockIn: Date | null;
  lunchStart: Date | null;
  lunchEnd: Date | null;
  clockOut: Date | null;
}): number | null {
  if (!entry.clockIn || !entry.clockOut) return null;

  const grossMs = entry.clockOut.getTime() - entry.clockIn.getTime();
  let lunchMs = 0;
  if (entry.lunchStart && entry.lunchEnd) {
    lunchMs = Math.max(0, entry.lunchEnd.getTime() - entry.lunchStart.getTime());
  }
  return Math.max(0, Math.round((grossMs - lunchMs) / 60000));
}

/**
 * Derives which single action is valid right now from what timestamps are already set —
 * this is what makes the time clock card only ever offer a legal next step. Mirrors the
 * brief's four-state flow exactly: Clock In → Start Lunch → End Lunch → Clock Out.
 */
export function deriveClockState(entry: TimeEntryDTO | null): TimeClockState {
  if (!entry || !entry.clockIn) return "BEFORE_WORK";
  if (entry.clockOut) return "CLOCKED_OUT";
  if (entry.lunchStart && !entry.lunchEnd) return "ON_LUNCH";
  if (entry.lunchEnd) return "AFTER_LUNCH";
  return "CLOCKED_IN";
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
