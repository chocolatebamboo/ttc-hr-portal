import type { PrismaClient } from "@prisma/client";
import { timeToMinutes } from "@/lib/time";
import { getPayrollPeriodWeeks, payrollPeriodOffsetForDate, formatWeekRange, getWeek, weekOffsetForDate } from "@/lib/week";

/**
 * Per-employee weekly hour cap (Employee.weeklyHourCap — see its own doc comment in
 * prisma/schema.prisma for the full story). CB, Nov 2026: "say for instance Danique is capped at
 * 10 hours per week... but we should still have the flexibility to [approve it anyway]."
 *
 * This is the one place that answers "would adding/changing these shift(s) push this person over
 * their own cap for the week(s) they fall in, and by how much" — called from every path that
 * creates or changes a Shift's scheduled hours: src/lib/availability.ts's
 * autoConfirmShiftForApprovedDate, and src/lib/shifts.ts's createShiftManually/
 * convertAvailabilityDateToShift/reassignShift/approveShiftChange. Deliberately NOT called from
 * cancelShift — cancelling only ever reduces someone's hours, nothing to warn about there.
 *
 * Deliberately never blocks by itself. The caller decides whether this is a first attempt (let
 * the WeeklyHourCapExceededError throw, so the UI can show the real numbers and a deliberate
 * "Approve anyway") or a confirmed retry (confirmOverCap = true, skip the check and let it
 * through) — enforceWeeklyHourCap below has no memory of which attempt it is; that's entirely
 * the caller's (and ultimately the admin's own click's) decision.
 */

export interface CandidateShift {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM", after startTime
}

export interface WeeklyCapViolation {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  existingHours: number;
  addedHours: number;
  projectedHours: number;
  cap: number;
  overBy: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "12.5" / "10" — no trailing ".0" for a whole number, one decimal otherwise. */
function fmtHours(n: number): string {
  const rounded = round1(n);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function buildMessage(employeeName: string, violations: WeeklyCapViolation[]): string {
  if (violations.length === 1) {
    const v = violations[0];
    return `This would put ${employeeName} at ${fmtHours(v.projectedHours)} hrs for the week of ${v.weekLabel} — ${fmtHours(v.overBy)} hrs over their ${fmtHours(v.cap)} hr weekly cap.`;
  }
  const parts = violations.map((v) => `${v.weekLabel} (${fmtHours(v.projectedHours)} hrs, ${fmtHours(v.overBy)} over)`);
  return `This would put ${employeeName} over their ${fmtHours(violations[0].cap)} hr weekly cap in ${violations.length} weeks: ${parts.join("; ")}.`;
}

export class WeeklyHourCapExceededError extends Error {
  violations: WeeklyCapViolation[];
  constructor(employeeName: string, violations: WeeklyCapViolation[]) {
    super(buildMessage(employeeName, violations));
    this.name = "WeeklyHourCapExceededError";
    this.violations = violations;
  }
}

/** Shift start/end are always "HH:MM" with endTime > startTime (TIME_RE/assertValidDateTime in
 *  shifts.ts guarantee a shift never crosses midnight), so this is always positive. */
function shiftHours(startTime: string, endTime: string): number {
  return (timeToMinutes(endTime) - timeToMinutes(startTime)) / 60;
}

/** Which week bucket (week1 Mon–Sun, week2 Mon–Fri of the pay period actually containing this
 *  date) a date falls in — reuses getPayrollPeriodWeeks/payrollPeriodOffsetForDate (src/lib/
 *  week.ts) so this always agrees with every other week-based view in the app (Team Schedule, My
 *  Tasks, Team Availability's week-bounded mode) about where one pay period's week boundary
 *  actually falls, never a plain calendar week. Falls back to a plain Monday-start calendar week
 *  only for the rare Sat/Sun gap between one period's Friday end and the next period's Monday
 *  start (PAYROLL_PERIOD_SPAN_DAYS's own doc comment in week.ts: that weekend belongs to
 *  NEITHER displayed period) — shifts essentially never land there, but this keeps the cap check
 *  meaningful instead of silently mis-bucketing a weekend shift into the wrong period's week. */
function weekBucketForDate(dateKey: string): { start: string; end: string } {
  const { week1, week2 } = getPayrollPeriodWeeks(payrollPeriodOffsetForDate(dateKey));
  if (week1.days.includes(dateKey)) return week1;
  if (week2.days.includes(dateKey)) return week2;
  return getWeek(weekOffsetForDate(dateKey));
}

/**
 * Reports every week (among the ones `candidates` touch) where adding them would push this
 * employee over their own weeklyHourCap — empty when they have no cap set, or when nothing would
 * go over. Sums every OTHER confirmed shift (status != CANCELLED) they already have in the same
 * week; `excludeShiftId` leaves out the one shift being changed in place (reassignShift/
 * approveShiftChange edit an existing row rather than only ever adding a new one), so it isn't
 * double-counted against itself.
 */
export async function checkWeeklyHourCap(
  tx: PrismaClient,
  employeeId: string,
  candidates: CandidateShift[],
  options: { excludeShiftId?: string } = {}
): Promise<WeeklyCapViolation[]> {
  if (candidates.length === 0) return [];

  const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { weeklyHourCap: true } });
  const cap = employee?.weeklyHourCap;
  if (cap == null) return [];

  const byWeek = new Map<string, { start: string; end: string; addedHours: number }>();
  for (const c of candidates) {
    const bucket = weekBucketForDate(c.date);
    const entry = byWeek.get(bucket.start) ?? { start: bucket.start, end: bucket.end, addedHours: 0 };
    entry.addedHours += shiftHours(c.startTime, c.endTime);
    byWeek.set(bucket.start, entry);
  }

  const violations: WeeklyCapViolation[] = [];
  for (const bucket of byWeek.values()) {
    const existingShifts = await tx.shift.findMany({
      where: {
        employeeId,
        date: { gte: bucket.start, lte: bucket.end },
        // CANCELLED is obviously no longer this person's hours; REASSIGNED means this exact
        // row got handed to someone else (reassignShift never edits employeeId in place — see
        // its own doc comment in shifts.ts), so it isn't this employee's scheduled time anymore
        // either, even though the row still carries their id.
        status: { notIn: ["CANCELLED", "REASSIGNED"] },
        ...(options.excludeShiftId ? { id: { not: options.excludeShiftId } } : {}),
      },
      select: { startTime: true, endTime: true },
    });
    const existingHours = existingShifts.reduce((sum, s) => sum + shiftHours(s.startTime, s.endTime), 0);
    const projectedHours = existingHours + bucket.addedHours;
    // Small epsilon — these are float hours, not exact binary fractions.
    if (projectedHours > cap + 0.001) {
      violations.push({
        weekStart: bucket.start,
        weekEnd: bucket.end,
        weekLabel: formatWeekRange(bucket.start, bucket.end),
        existingHours: round1(existingHours),
        addedHours: round1(bucket.addedHours),
        projectedHours: round1(projectedHours),
        cap,
        overBy: round1(projectedHours - cap),
      });
    }
  }
  return violations;
}

/**
 * The shared gate every mutation call site uses, right before it actually writes anything — a
 * throw here, inside the same transaction as the rest of that call, rolls back nothing because
 * nothing's been written yet. `confirmOverCap` is the admin's own deliberate "Approve anyway"
 * (threaded all the way from the API route's request body); true skips the check entirely rather
 * than re-running it only to ignore the result, since a second violation check right after the
 * first would just waste a query.
 *
 * Deliberately takes just `employeeId`, not a resolved name — the extra lookup for a display
 * name only happens on the rare violation path below, not on every ordinary call, so every call
 * site gets to skip resolving (or even having on hand) the employee's name just to make this
 * check.
 */
export async function enforceWeeklyHourCap(
  tx: PrismaClient,
  employeeId: string,
  candidates: CandidateShift[],
  confirmOverCap: boolean,
  options: { excludeShiftId?: string } = {}
): Promise<void> {
  if (confirmOverCap) return;
  const violations = await checkWeeklyHourCap(tx, employeeId, candidates, options);
  if (violations.length === 0) return;

  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    select: { firstName: true, lastName: true, preferredName: true },
  });
  const employeeName = employee ? `${employee.preferredName || employee.firstName} ${employee.lastName}` : "This team member";
  throw new WeeklyHourCapExceededError(employeeName, violations);
}
