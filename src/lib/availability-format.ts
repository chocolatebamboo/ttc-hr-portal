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

export interface SlotChip {
  /** Raw "YYYY-MM-DD" — the stable key used to scope a conversation to this specific date
   *  (see TeamNote.topicDate in prisma/schema.prisma), never shown to the user directly. */
  date: string;
  dateLabel: string;
  timeLabel: string;
}

/** Same slots, split into a {date, time} pair per entry rather than one combined string — CB
 *  (Sept 2026), after the first admin card redesign: a multi-date submission rendered as a
 *  dense stack of "Thu, Sep 17: 9:00 AM – 5:00 PM" lines read as "just a bunch of words and
 *  letters." TeamAvailabilityCards/TeamPtoCards render each of these as its own small colored
 *  chip instead — the date bold on top, the time range beneath it — so a five-date submission
 *  reads as a scannable row of chips rather than five run-on sentences. Each chip is now also
 *  its own tap target for a per-date conversation (Sept 2026, round two of the redesign) — CB:
 *  "each scheduled day may have different requests... I wanted to make comments under each day
 *  that was selected" — which is why the raw date comes along, not just its display label. */
export function slotChips(slots: AvailabilitySlot[]): SlotChip[] {
  return [...slots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({
      date: s.date,
      dateLabel: formatSlotDate(s.date),
      timeLabel: `${formatTime12h(s.startTime)} – ${formatTime12h(s.endTime)}`,
    }));
}
