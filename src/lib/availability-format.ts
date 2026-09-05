import type { AvailabilitySlot } from "@/types";

/** "14:00" -> "2:00 PM". Slots are always stored/validated as 24-hour "HH:MM" (see
 *  assertValidSlots in src/lib/availability.ts) — this is purely a display format. */
export function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "2026-09-17" -> "Thu, Sep 17" — short enough to sit next to a time range on one line. */
export function formatSlotDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** One slot per line, earliest date first — "Thu, Sep 17: 9:00 AM – 5:00 PM". */
export function describeSlots(slots: AvailabilitySlot[]): string[] {
  return [...slots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => `${formatSlotDate(s.date)}: ${formatTime12h(s.startTime)} – ${formatTime12h(s.endTime)}`);
}
