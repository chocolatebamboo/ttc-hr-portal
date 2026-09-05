import type { AvailabilitySlot } from "@/types";

/** Full day names, Sunday-first — matches AvailabilitySlot.dayOfWeek (0 = Sunday, same as
 *  Date.getDay()) and the Sunday-first convention TimesheetCalendar's own WEEKDAY_LABELS
 *  already uses, just spelled out (a form reads better with full names than single letters). */
export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "14:00" -> "2:00 PM". Slots are always stored/validated as 24-hour "HH:MM" (see
 *  assertValidSlots in src/lib/availability.ts) — this is purely a display format. */
export function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** One slot per line, in day order — "Monday: 9:00 AM – 5:00 PM". A day absent from `slots`
 *  is simply omitted rather than listed as "not available," since the empty state (nothing
 *  submitted yet) is handled separately by each view. */
export function describeSlots(slots: AvailabilitySlot[]): string[] {
  return [...slots]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((s) => `${DAY_LABELS[s.dayOfWeek]}: ${formatTime12h(s.startTime)} – ${formatTime12h(s.endTime)}`);
}
