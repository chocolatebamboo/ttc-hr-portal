import type { TimeClockState, TimeEntryDTO } from "@/types";

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

export function formatClockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
