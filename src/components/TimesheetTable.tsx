"use client";

import StatusPill from "@/components/StatusPill";
import { formatClockTime, formatMinutes } from "@/lib/time";
import type { TimeEntryDTO } from "@/types";

/** Every calendar day in the week, filled in from `entries` where an entry exists — a day
 *  with no row is a real "Missing Entry" the employee/HR should notice, not a blank. */
export default function TimesheetTable({
  days,
  entries,
}: {
  days: string[]; // ISO date strings, Mon..Sun
  entries: TimeEntryDTO[];
}) {
  const byDate = new Map(entries.map((e) => [e.workDate.slice(0, 10), e]));
  const weeklyMinutes = entries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-black/[0.02] text-left text-xs uppercase tracking-wide text-muted/70">
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Clock In</th>
            <th className="px-4 py-2.5 font-medium">Lunch</th>
            <th className="px-4 py-2.5 font-medium">Clock Out</th>
            <th className="px-4 py-2.5 font-medium">Hours</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {days.map((day) => {
            const entry = byDate.get(day);
            const label = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return (
              <tr key={day}>
                <td className="px-4 py-2.5 whitespace-nowrap">{label}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatClockTime(entry?.clockIn ?? null)}</td>
                <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
                  {entry?.lunchStart
                    ? `${formatClockTime(entry.lunchStart)} – ${formatClockTime(entry.lunchEnd)}`
                    : "—"}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{formatClockTime(entry?.clockOut ?? null)}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatMinutes(entry?.totalMinutes ?? null)}</td>
                <td className="px-4 py-2.5">
                  <StatusPill status={entry?.status ?? "MISSING_ENTRY"} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-black/[0.02] font-medium">
            <td className="px-4 py-2.5" colSpan={4}>
              Weekly total
            </td>
            <td className="px-4 py-2.5 tabular-nums">{formatMinutes(weeklyMinutes)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
