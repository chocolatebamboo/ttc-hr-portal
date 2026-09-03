function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface MonthDay {
  date: string; // ISO date key, e.g. "2026-09-08"
  /** False for the leading/trailing days from the adjacent month shown only to keep the grid
   *  a full 7-wide rectangle (matches how most calendar UIs, including the Airbnb host
   *  calendar CB referenced, pad the first/last week rather than starting mid-row). */
  inMonth: boolean;
  isToday: boolean;
  /** After today — there's no time entry to show yet and none to correct, so the calendar
   *  renders these as plainly non-interactive rather than an empty/"Missing Entry" cell that
   *  would wrongly suggest something was expected and didn't happen. */
  isFuture: boolean;
}

export interface Month {
  label: string; // "September 2026"
  /** The actual first/last day OF the month (not the padded grid range) — what gets sent to
   *  the API as the fetch window. */
  start: string;
  end: string;
  /** Sunday-start weeks, always exactly 7 days each, padded at both ends so every row is full. */
  weeks: MonthDay[][];
}

/** `offsetMonths` months from the current one (0 = this month, -1 = last). Relies on the Date
 *  constructor's own month-overflow normalization (new Date(year, -1, 1) rolls back to
 *  December of the previous year) rather than doing that arithmetic by hand. */
export function getMonth(offsetMonths: number): Month {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  const todayKey = toDateKey(now);

  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const weeks: MonthDay[][] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week: MonthDay[] = [];
    for (let i = 0; i < 7; i++) {
      const key = toDateKey(cursor);
      week.push({
        date: key,
        inMonth: cursor.getMonth() === firstOfMonth.getMonth(),
        isToday: key === todayKey,
        isFuture: key > todayKey,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return {
    label: firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    start: toDateKey(firstOfMonth),
    end: toDateKey(lastOfMonth),
    weeks,
  };
}
