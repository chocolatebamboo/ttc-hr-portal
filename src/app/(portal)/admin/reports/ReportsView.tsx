"use client";

import { useEffect, useState } from "react";
import type { PayrollHoursReportDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The one report this app produces: approved hours, ready to hand to TTC's payroll company.
 * Deliberately just hours — no pay rate, no overtime multiplier, no tax withholding — that
 * math belongs to the payroll company, per the brief's payroll-handoff boundary.
 */
export default function ReportsView() {
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(todayDateKey());
  const [report, setReport] = useState<PayrollHoursReportDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  async function generate(s: string, e: string) {
    setLoadState("loading");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/payroll/hours?start=${s}&end=${e}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadState("error");
        setErrorMessage(data.error ?? "Unable to generate the report. Please try again.");
        return;
      }
      setReport(data);
      setLoadState(data.rows.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
      setErrorMessage("Unable to reach the server. Check your connection and try again.");
    }
  }

  // Initial load only — regenerating after this happens via the explicit "Generate" button
  // below, not on every keystroke while someone is still picking dates, so deps stay empty.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    generate(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(start, end);
  }

  const rangeInvalid = end < start;

  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">Reports</h1>
      <p className="text-sm text-muted mb-4">
        Approved hours for a pay period, ready to hand to your payroll company. This is hours only
        — no pay rate, overtime, or tax math happens here.
      </p>

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-4 mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Start date</label>
          <input
            type="date"
            required
            value={start}
            onChange={(ev) => setStart(ev.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">End date</label>
          <input
            type="date"
            required
            value={end}
            onChange={(ev) => setEnd(ev.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button type="submit" disabled={rangeInvalid || loadState === "loading"} className="btn-primary text-sm px-5 py-2">
          {loadState === "loading" ? "Generating…" : "Generate"}
        </button>
        {report && loadState !== "error" && (
          <a
            href={`/api/payroll/hours/csv?start=${start}&end=${end}`}
            className="btn-neutral text-sm px-5 py-2"
          >
            Download CSV
          </a>
        )}
        {rangeInvalid && <p className="text-xs text-accent basis-full">End date must be on or after the start date.</p>}
      </form>

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">{errorMessage}</div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No approved hours in this period yet.
        </div>
      )}

      {loadState === "ready" && report && (
        <div>
          {report.unapprovedEntryCount > 0 && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent-ink mb-4">
              {report.unapprovedEntryCount} time {report.unapprovedEntryCount === 1 ? "entry" : "entries"} in this
              period {report.unapprovedEntryCount === 1 ? "isn't" : "aren't"} approved yet, so{" "}
              {report.unapprovedEntryCount === 1 ? "its" : "their"} hours aren&apos;t included below. Check My Team
              before running payroll on this export.
            </div>
          )}

          <div className="bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 font-medium">Department</th>
                  <th className="px-4 py-2.5 font-medium text-right">Regular</th>
                  <th className="px-4 py-2.5 font-medium text-right">Vacation</th>
                  <th className="px-4 py-2.5 font-medium text-right">Sick</th>
                  <th className="px-4 py-2.5 font-medium text-right">Personal</th>
                  <th className="px-4 py-2.5 font-medium text-right">Other Leave</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted">{row.employeeCode}</p>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{row.department ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.regularHours.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.vacationHours.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.sickHours.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.personalHours.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.otherLeaveHours.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{row.totalHours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
