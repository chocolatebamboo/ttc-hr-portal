"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWeek, formatWeekRange } from "@/lib/week";
import type { AdminAttendanceRowDTO, AssignmentOptionsDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/**
 * HR-wide attendance dashboard — every active employee for the selected week, with a
 * department filter and the two things README's roadmap calls out: entries still awaiting
 * approval, and missing clock-outs. Clicking a row goes to the same per-employee review page
 * a supervisor uses (src/app/(portal)/team/[employeeId]) — admins can already open any
 * employee there (canAccessEmployeeRecords' admin bypass), so no separate review UI is needed.
 */
export default function AttendanceAdminView() {
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
        Every active team member&apos;s timesheet status for the selected week. Click a row to review
        and approve that team member&apos;s time.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="btn-neutral h-8 w-8 text-sm"
            aria-label="Previous week"
          >
            ←
          </button>
          <span className="text-sm text-muted min-w-[150px] text-center tabular-nums">
            {formatWeekRange(week.start, week.end)}
          </span>
          <button
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset === 0}
            className="btn-neutral h-8 w-8 text-sm"
            aria-label="Next week"
          >
            →
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
        <div className="bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Team Member</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium text-right">Awaiting Approval</th>
                <th className="px-4 py-2.5 font-medium text-right">Missing Clock-Outs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.employeeId} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/team/${row.employeeId}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted">{row.jobTitle}</p>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{row.department ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.awaitingApprovalCount > 0 ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
                        {row.awaitingApprovalCount}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.missingClockOutCount > 0 ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-100 text-rose-800">
                        {row.missingClockOutCount}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
