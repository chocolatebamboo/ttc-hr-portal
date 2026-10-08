function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday-start week, `offsetWeeks` weeks from the current one (0 = this week, -1 = last). */
export function getWeek(offsetWeeks: number) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(toDateKey(d));
  }

  return { start: days[0], end: days[6], days };
}

/** Inverse of getWeek: given a date key, how many weeks away its own Monday-start week is from
 *  "this week" (0), same sign convention as getWeek's own offsetWeeks (negative = past, positive
 *  = future). Oct 2026 — lets a deep link to one specific date (MyTasksView's own ?date= param,
 *  from the "Tasks" link on an Availability/Schedule card) land the week-paginated view on the
 *  week that date actually falls in, instead of always defaulting to "this week." */
export function weekOffsetForDate(dateKey: string): number {
  const { start } = getWeek(0);
  const startDate = new Date(`${start}T00:00:00`);
  const targetDate = new Date(`${dateKey}T00:00:00`);
  const diffDays = Math.round((targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7);
}

export function formatWeekRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const sameMonth = s.getMonth() === e.getMonth();
  const startLabel = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = e.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}, ${e.getFullYear()}`;
}
