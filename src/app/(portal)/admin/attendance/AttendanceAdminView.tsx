"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWeek, formatWeekRange } from "@/lib/week";
import type { AdminAttendanceRowDTO, AssignmentOptionsDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

// Same local-copy convention every other consumer of "initials from a name" already follows in
// this app (see TeamScheduleGlance.tsx's own doc comment on this exact choice).
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * HR-wide attendance dashboard — every active employee for the selected week, with a
 * department filter and the two things README's roadmap calls out: entries still awaiting
 * approval, and missing clock-outs. Clicking a row goes to the same per-employee review page
 * a supervisor uses (src/app/(portal)/team/[employeeId]) — admins can already open any
 * employee there (canAccessEmployeeRecords' admin bypass), so no separate review UI is needed.
 *
 * Oct 2026 (CB, from live screenshots: "it's still showing the department as operations, that
 * doesn't make sense... I need it to look more widgetized... we need to clearly communicate on
 * whether it's the current seven-day work schedule... I should see an option to kind of look at
 * the past archive ones... or being able to see what's in the future as well"). Approved via
 * mockup first (her standing requirement for this kind of visual change) before landing here:
 * - The plain table becomes person-cards — avatar, name, real job title. The Department column
 *   is gone; it was "Operations" for almost everyone here and added nothing the job title
 *   didn't already say (same call already made on Team Schedule's person headers). The
 *   department FILTER above is untouched — still useful even though it's no longer its own
 *   column.
 * - The week nav's "This week" badge only shows when `offset` is actually 0, so it's never
 *   ambiguous which range is on screen. Previously `offset` could only go negative (the "Next
 *   week" button was disabled past 0) — that's lifted below so paging forward into future weeks
 *   works the same as paging back into past ones.
 * - A row with nothing outstanding reads as "All caught up" in quiet gray instead of printing
 *   two more "0" pills — only what actually needs attention gets a colored pill, so scanning the
 *   list means scanning for color, not reading every number.
 *
 * `scope`, set by the server page from the viewer's own role (Oct 2026, same split
 * ReportsView/PtoAdminView already take): "all" for HR/Super Admin — every active employee,
 * department filter included. "team" for a Supervisor — listAdminAttendance itself narrows the
 * rows to their own direct reports regardless of what this prop says; it only drives the copy
 * below so a Supervisor doesn't read "every active team member" over a list that's actually
 * just theirs.
 */
export default function AttendanceAdminView({ scope }: { scope: "all" | "team" }) {
  const [offset, setOffset] = useState(0);
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<AssignmentOptionsDTO["departments"]>([]);
  const [rows, setRows] = useState<AdminAttendanceRowDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const week = getWeek(offset);

  useEffect(() => {
    fetch("/api/roster/assignable")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AssignmentOptionsDTO | null) => {
        if (data) setDepartments(data.departments);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      setLoadState("loading");
      try {
        const params = new URLSearchParams({ start: week.start, end: week.end });
        if (departmentId) params.set("departmentId", departmentId);
        const res = await fetch(`/api/admin/attendance?${params}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRows(data.rows);
        setLoadState(data.rows.length === 0 ? "empty" : "ready");
      } catch {
        setLoadState("error");
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, departmentId]);

  const totalAwaiting = rows.reduce((sum, r) => sum + r.awaitingApprovalCount, 0);
  const totalMissing = rows.reduce((sum, r) => sum + r.missingClockOutCount, 0);

  return (
    <div>
      <h1 className="page-title text-2xl mb-1">Attendance</h1>
      <p className="text-sm text-muted mb-4">
        {scope === "team"
          ? "Your own team's timesheet status for the selected week. Click a row to review and approve that team member's time."
          : "Every active team member's timesheet status for the selected week. Click a row to review and approve that team member's time."}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
            aria-label="Previous week"
          >
            ‹
          </button>
          <span className="text-sm font-semibold min-w-[140px] text-center tabular-nums">
            Week of {formatWeekRange(week.start, week.end)}
          </span>
          {offset === 0 && (
            <span className="text-[11px] font-semibold text-accent-ink bg-accent/10 rounded-full px-2.5 py-0.5">
              This week
            </span>
          )}
          <button
            onClick={() => setOffset((o) => o + 1)}
            className="h-7 w-7 rounded-full border border-border flex items-center justify-center text-sm text-muted hover:text-foreground hover:bg-black/[0.03]"
            aria-label="Next week"
          >
            ›
          </button>
        </div>

        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {loadState === "ready" && (totalAwaiting > 0 || totalMissing > 0) && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent-ink mb-4">
          {totalAwaiting > 0 && (
            <span>
              {totalAwaiting} {totalAwaiting === 1 ? "day" : "days"} awaiting approval
            </span>
          )}
          {totalAwaiting > 0 && totalMissing > 0 && <span> · </span>}
          {totalMissing > 0 && (
            <span>
              {totalMissing} missing {totalMissing === 1 ? "clock-out" : "clock-outs"}
            </span>
          )}
        </div>
      )}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load attendance. Please try again or contact support.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No active team members{departmentId ? " in this department" : ""} yet.
        </div>
      )}

      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {rows.map((row, i) => {
            const hasOutstanding = row.awaitingApprovalCount > 0 || row.missingClockOutCount > 0;
            return (
              <Link
                key={row.employeeId}
                href={`/team/${row.employeeId}`}
                className={`flex items-center gap-3.5 px-5 py-3.5 hover:bg-black/[0.02] transition-colors ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <span
                  className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                  style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
                >
                  {initialsOf(row.name) || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{row.name}</p>
                  <p className="text-xs text-muted truncate">{row.jobTitle}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hasOutstanding ? (
                    <>
                      {row.awaitingApprovalCount > 0 && (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
                          {row.awaitingApprovalCount} awaiting approval
                        </span>
                      )}
                      {row.missingClockOutCount > 0 && (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-100 text-rose-800">
                          {row.missingClockOutCount} missing {row.missingClockOutCount === 1 ? "clock-out" : "clock-outs"}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted">All caught up</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
