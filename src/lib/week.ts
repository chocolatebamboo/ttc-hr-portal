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
 *  lastTwoWeeksRange, the original home of this logic, for the full story). Pulled out to a
 *  shared home (Round eight, CB, on LoggedHoursSection's own "Total, last 90 days" card: "I need
 *  this to be reflecting the two-week report... toggle between the different two-week reports")
 *  so the Reports page's "2-Week Report" preset, the employee-facing Logged hours widget, and My
 *  Tasks' pay-period paging always agree on exactly where one period ends and the next begins.
 *
 *  Round nine (CB, Oct 9 2026): first anchor attempt, corrected same-day to "2026-10-08" as one
 *  confirmed period's last day, with every period a 14-day INCLUSIVE block (end minus 13 days).
 *
 *  Round ten (CB, Oct 2026, pointing at a Reports default of Sep 25 – Oct 8 while the period
 *  actually active that day was Oct 12 – 23): round nine's anchor was wrong by more than a day —
 *  TTC's real payroll weeks don't run as one unbroken 14-day block at all. CB's own unambiguous
 *  worked example: the period active right now runs Monday Oct 12 through Friday Oct 23 (12
 *  calendar days), and the next one starts Monday Oct 26 through Friday Nov 6. The Saturday/
 *  Sunday between one period's Friday and the next period's Monday belongs to NEITHER period —
 *  confirmed via AskUserQuestion before changing this a third time, given this exact constant has
 *  already needed one prior correction. Replaced the single "14-day inclusive block" shape with a
 *  Monday-start anchor plus two separate numbers: the CYCLE (14 days, one period's start to the
 *  next's) and the SPAN (12 days, the Monday through the following Friday that's actually
 *  displayed) — a period's displayed end is no longer just "anchor plus a multiple of the cycle,"
 *  since span and cycle are different lengths now. */
export const PAYROLL_PERIOD_START_ANCHOR = "2026-10-12"; // a confirmed period's first day (Monday)
export const PAYROLL_PERIOD_CYCLE_DAYS = 14; // days from one period's start to the next period's start
export const PAYROLL_PERIOD_SPAN_DAYS = 12; // Monday through the following Friday, inclusive

/** The payroll period CONTAINING today, offset by `offsetPeriods` whole cycles (0 = today's own
 *  period, -1 = the one before that, 1 = the one after). Unlike round nine's "most recently
 *  closed" rule, offset 0 is always whichever period today actually falls in — including the
 *  Sat/Sun gap right after a period's Friday end, which keeps showing that period (not the next
 *  one) until its Monday actually arrives, same "doesn't flip until the next period really
 *  starts" idea round nine had, just anchored to the period's START instead of its END. */
export function getPayrollPeriod(offsetPeriods = 0): { start: string; end: string } {
  const anchor = new Date(`${PAYROLL_PERIOD_START_ANCHOR}T00:00:00`);
  const today = new Date(`${toDateKey(new Date())}T00:00:00`);
  const daysSinceAnchor = Math.round((today.getTime() - anchor.getTime()) / 86400000);
  const periodsElapsed = Math.floor(daysSinceAnchor / PAYROLL_PERIOD_CYCLE_DAYS);
  const startDate = new Date(anchor);
  startDate.setDate(startDate.getDate() + (periodsElapsed + offsetPeriods) * PAYROLL_PERIOD_CYCLE_DAYS);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (PAYROLL_PERIOD_SPAN_DAYS - 1));
  return { start: toDateKey(startDate), end: toDateKey(endDate) };
}

/** Which getPayrollPeriod offset contains TODAY — always 0 now, since getPayrollPeriod(0) is
 *  itself defined as "today's own period" (see its own doc comment). Kept as a real function
 *  rather than inlining a literal 0 at every call site: ReportsView/LoggedHoursSection/My
 *  Tasks/Team Tasks all ask "what's current" through this one name, so a future change to what
 *  "current" means only has to happen here. */
export function getCurrentPayrollPeriodOffset(): number {
  return 0;
}

/** Inverse of getPayrollPeriod, same shape as weekOffsetForDate above but for pay periods
 *  instead of calendar weeks: given a date key, which getPayrollPeriod offset its own period is
 *  from today's (0 = today's own period — see getPayrollPeriod's own doc comment — negative
 *  further into the past, positive into the future). Round four (CB, Oct 2026, on My Tasks: "I
 *  should be able to see all the tasks that's [under] review for that period of time... based
 *  off of those two week intervals"): MyTasksView's own `?date=` deep link (from the "Tasks" link
 *  on an Availability/Schedule card) uses this the same way weekOffsetForDate used to, now that
 *  both of that page's tabs page by 2-week period instead of calendar week. */
export function payrollPeriodOffsetForDate(dateKey: string): number {
  const anchor = new Date(`${PAYROLL_PERIOD_START_ANCHOR}T00:00:00`);
  const today = new Date(`${toDateKey(new Date())}T00:00:00`);
  const target = new Date(`${dateKey}T00:00:00`);
  const todaysDaysSinceAnchor = Math.round((today.getTime() - anchor.getTime()) / 86400000);
  const periodsElapsedToday = Math.floor(todaysDaysSinceAnchor / PAYROLL_PERIOD_CYCLE_DAYS);
  const targetDaysSinceAnchor = Math.round((target.getTime() - anchor.getTime()) / 86400000);
  const periodsElapsedTarget = Math.floor(targetDaysSinceAnchor / PAYROLL_PERIOD_CYCLE_DAYS);
  return periodsElapsedTarget - periodsElapsedToday;
}

export function formatWeekRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const sameMonth = s.getMonth() === e.getMonth();
  const startLabel = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = e.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}, ${e.getFullYear()}`;
}
