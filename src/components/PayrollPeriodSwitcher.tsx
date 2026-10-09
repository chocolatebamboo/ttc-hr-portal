"use client";

import { getCurrentPayrollPeriodOffset, getPayrollPeriod, formatWeekRange } from "@/lib/week";

/**
 * Shared pay-period pill — prev/next round-arrow buttons, the period's own date range, and a
 * "Current" badge/shortcut at whichever offset actually contains today (getCurrentPayrollPeriodOffset
 * — not always 0; see that helper's own doc comment in src/lib/week.ts). Same rounded-pill chrome
 * TeamAvailabilityWeekPanel's week nav and LoggedHoursSection's own pay-period switcher already use,
 * so paging through periods reads the same way everywhere in the app.
 *
 * Round three (CB, Oct 2026, on My Tasks, after a screenshot of Haile's own "My Tasks" view
 * showing "Nothing assigned for this week" even though she had a task awaiting review from two
 * and a half weeks earlier): "I should be able to see all the tasks that's [under] review for
 * that period of time... based off of those two week intervals." Both of MyTasksView's tabs ("My
 * tasks" and "Awaiting review," which previously paged by calendar week and didn't page at all,
 * respectively) now use this one switcher instead of each hand-rolling their own.
 *
 * `capNextAtCurrent`: off by default (My Tasks) since a task can legitimately be assigned for a
 * future date. LoggedHoursSection's own switcher (not rebuilt on top of this component, to avoid
 * re-touching an already-shipped, already-verified file) caps it instead, since a future pay
 * period can't have any hours logged yet.
 */
export default function PayrollPeriodSwitcher({
  offset,
  onOffsetChange,
  capNextAtCurrent = false,
  label = "Pay period",
}: {
  offset: number;
  onOffsetChange: (offset: number) => void;
  capNextAtCurrent?: boolean;
  label?: string;
}) {
  const currentOffset = getCurrentPayrollPeriodOffset();
  const period = getPayrollPeriod(offset);
  const rangeLabel = formatWeekRange(period.start, period.end);

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
      <button
        type="button"
        onClick={() => onOffsetChange(offset - 1)}
        aria-label={`Previous ${label.toLowerCase()}`}
        className="h-7 w-7 shrink-0 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
      >
        ‹
      </button>
      <span className="text-sm font-semibold min-w-[150px] text-center tabular-nums">{rangeLabel}</span>
      {offset === currentOffset ? (
        <span className="text-[11px] font-semibold text-accent-ink bg-accent/10 rounded-full px-2.5 py-0.5 shrink-0">
          Current
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onOffsetChange(currentOffset)}
          className="text-[11px] font-semibold text-accent-ink hover:underline shrink-0"
        >
          Current
        </button>
      )}
      <button
        type="button"
        onClick={() => onOffsetChange(offset + 1)}
        disabled={capNextAtCurrent && offset >= currentOffset}
        aria-label={`Next ${label.toLowerCase()}`}
        className="h-7 w-7 shrink-0 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03] disabled:opacity-30 disabled:pointer-events-none"
      >
        ›
      </button>
    </div>
  );
}
