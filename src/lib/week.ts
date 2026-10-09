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

/** TTC's real biweekly payroll calendar (Round four/seven, Oct 2026 — see ReportsView's own
 *  lastTwoWeeksRange, the original home of this logic, for the full story). PAYROLL_PERIOD_END_
 *  ANCHOR is one confirmed period's last day (Thu, Oct 9 2026 — CB: "tomorrow is Friday... the
 *  payroll is every two weeks on a Friday... it's going to restart pretty much tomorrow," i.e.
 *  the period ending Oct 9 closes and the next one starts Oct 10); every other period end, past
 *  or future, falls exactly a whole number of 14-day blocks from that one date. Pulled out to a
 *  shared home (Round eight, CB, on LoggedHoursSection's own "Total, last 90 days" card: "I need
 *  this to be reflecting the two-week report... toggle between the different two-week reports")
 *  so the Reports page's "2-Week Report" preset and the employee-facing Logged hours widget
 *  always agree on exactly where one period ends and the next begins. */
export const PAYROLL_PERIOD_END_ANCHOR = "2026-10-09";
export const PAYROLL_PERIOD_DAYS = 14;

/** The most recently CLOSED 14-day payroll period as of today, offset by `offsetPeriods` whole
 *  periods (0 = current/most-recently-closed, -1 = the one before that, 1 = the one in progress
 *  now). Same "most recently closed, not a rolling N days ending today" rule lastTwoWeeksRange
 *  established — a period keeps showing as current all the way through its successor actually
 *  closing, no matter what day someone happens to look. */
export function getPayrollPeriod(offsetPeriods = 0): { start: string; end: string } {
  const anchor = new Date(`${PAYROLL_PERIOD_END_ANCHOR}T00:00:00`);
  const today = new Date(`${toDateKey(new Date())}T00:00:00`);
  const daysSinceAnchor = Math.round((today.getTime() - anchor.getTime()) / 86400000);
  const periodsElapsed = Math.floor(daysSinceAnchor / PAYROLL_PERIOD_DAYS);
  const endDate = new Date(anchor);
  endDate.setDate(endDate.getDate() + (periodsElapsed + offsetPeriods) * PAYROLL_PERIOD_DAYS);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (PAYROLL_PERIOD_DAYS - 1));
  return { start: toDateKey(startDate), end: toDateKey(endDate) };
}

/** Which getPayrollPeriod offset contains TODAY specifically — 0 on the single day a period is
 *  also closing (today is itself a period's last day, same day getPayrollPeriod(0) already
 *  resolves to), 1 on every other day, since getPayrollPeriod(0) is always the most recently
 *  CLOSED period (see its own doc comment) and the period actually in progress right now is
 *  always the very next one after that. ReportsView's payroll report deliberately keeps showing
 *  offset 0 (the last CLOSED period) throughout the next one being in progress — it's a report,
 *  not a live counter. LoggedHoursSection is the opposite: an employee's own "what have I logged"
 *  widget should open on whatever period they're actively logging into, so it uses this as its
 *  default and as the cap its own "Next period" button won't go past. */
export function getCurrentPayrollPeriodOffset(): number {
  const anchor = new Date(`${PAYROLL_PERIOD_END_ANCHOR}T00:00:00`);
  const today = new Date(`${toDateKey(new Date())}T00:00:00`);
  const daysSinceAnchor = Math.round((today.getTime() - anchor.getTime()) / 86400000);
  return daysSinceAnchor % PAYROLL_PERIOD_DAYS === 0 ? 0 : 1;
}

export function formatWeekRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const sameMonth = s.getMonth() === e.getMonth();
  const startLabel = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = e.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}, ${e.getFullYear()}`;
}
