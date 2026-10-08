"use client";

import { useEffect, useState } from "react";
import { getWeek, formatWeekRange } from "@/lib/week";
import ActivityHistoryView from "./ActivityHistoryView";
import type { PayrollHoursReportDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";
type EmployeeOption = { id: string; name: string };

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "This week"/"This month" presets — CB's own framing for this report ("at the end of the
 *  week... a full report", "at the end of the month... tallies") is calendar-week/calendar-
 *  month, not an arbitrary range, so those are one click instead of two manual date pickers. */
function thisWeekRange(): { start: string; end: string } {
  const week = getWeek(0);
  return { start: week.start, end: todayDateKey() < week.end ? todayDateKey() : week.end };
}

/** Round four (CB, Oct 2026): "a 'last 2 weeks' button... matching Shawn's biweekly payroll
 *  pull cadence" — the 14 days ending today, not a calendar-aligned pair of weeks, since what
 *  matters here is matching whenever Shawn actually runs payroll, not the calendar's own week
 *  boundaries. */
function lastTwoWeeksRange(): { start: string; end: string } {
  const end = todayDateKey();
  const endDate = new Date(`${end}T00:00:00`);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 13);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

// Same local-copy convention every other consumer of "initials from a name" already follows in
// this app (see TeamScheduleGlance.tsx's own doc comment on this exact choice) — used below for
// the single-employee "full report" banner's avatar.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/** Short weekday + month/day for the unapproved-entries list — plain Date formatting rather
 *  than reaching for formatSlotDate (that one's tuned for a shift/task row's own fuller date
 *  label; this list is compact by design, one line per entry). */
function formatShortDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The one report this app produces: approved hours, ready to hand to TTC's payroll company.
 * Deliberately just hours — no pay rate, no overtime multiplier, no tax withholding — that
 * math belongs to the payroll company, per the brief's payroll-handoff boundary.
 */
type Tab = "payroll" | "activity";

/**
 * `scope`, set by the server page from the viewer's own role (correction brief #8, Sept 2026,
 * "Administrative access and role audit"):
 *  - "all": SUPER_ADMIN/HR_ADMIN — the original full-company view, both tabs.
 *  - "team": SUPERVISOR — same Payroll Hours report, but the team-member picker only ever
 *    offers their own direct reports (see loadEmployees below; getPayrollHoursReport enforces
 *    the same narrowing server-side regardless of what this picker shows). Activity History
 *    doesn't render at all for this scope — that tab reads the org-wide AuditLog, which stays
 *    admin-only (see canAccessReports's own doc comment in src/lib/authorization.ts for why).
 */
export default function ReportsView({ scope }: { scope: "all" | "team" }) {
  // Phase 4 (client spec, Sept 2026): "Reports and Activity History views" — same page, a tab
  // switcher between the pre-existing payroll-hours export and the new Activity History filter
  // below, rather than a separate nav entry for one more admin-only list.
  const [tab, setTab] = useState<Tab>("payroll");
  // Round five (CB): "since the reports need to be every two weeks for payroll... how can we
  // best present it... so she could easily have the two week report" — Sean and Daijour's own
  // payroll pull is always this exact 14-day window, so Reports now opens straight into it
  // instead of making them click "Last 2 weeks" themselves every time. "This month"/"This week"
  // are still one click away for anyone who actually wants a different range.
  const [start, setStart] = useState(lastTwoWeeksRange().start);
  const [end, setEnd] = useState(lastTwoWeeksRange().end);
  // "" means every employee (the original full-company view) — CB: "I could imagine it would
  // be nice to... look at somebody's specific hours [without having to] go through the whole
  // list of people", but also still wants the full view available, so this is additive rather
  // than a replacement for the no-filter report.
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [report, setReport] = useState<PayrollHoursReportDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  // Round four (CB, Oct 2026, on the mockup: "there should be a way that we could kind of view
  // those entries that are not necessarily approved... so we could go back there"): the banner
  // itself now toggles this instead of just sitting there as inert text.
  const [showUnapproved, setShowUnapproved] = useState(false);

  async function generate(s: string, e: string, empId: string) {
    setLoadState("loading");
    setErrorMessage("");
    try {
      const query = `?start=${s}&end=${e}${empId ? `&employeeId=${empId}` : ""}`;
      const res = await fetch(`/api/payroll/hours${query}`);
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

  async function loadEmployees() {
    try {
      // "team" scope (a Supervisor): /api/roster/assignable is the full-company picker every
      // other admin form shares (Documents, Announcements) and stays admin-only on purpose —
      // reusing it here would mean either loosening it for everyone or teaching it a second,
      // narrower mode it doesn't otherwise need. /api/team/reports already returns exactly the
      // right list (the caller's own direct reports, no admin gate) since My Team already
      // renders from it, so this borrows that instead of adding a new endpoint.
      if (scope === "team") {
        const res = await fetch("/api/team/reports");
        if (!res.ok) return;
        const data: { reports: { id: string; firstName: string; lastName: string; preferredName: string | null; employmentStatus: string }[] } =
          await res.json();
        setEmployees(
          data.reports
            .filter((r) => r.employmentStatus === "ACTIVE")
            .map((r) => ({ id: r.id, name: `${r.preferredName || r.firstName} ${r.lastName}` }))
        );
        return;
      }
      const res = await fetch("/api/roster/assignable");
      if (!res.ok) return;
      const data = await res.json();
      setEmployees(data.employees ?? []);
    } catch {
      // Non-fatal — the picker just stays empty and the report still works unfiltered.
    }
  }

  // Initial load only — regenerating after this happens via the explicit "Generate" button
  // below, not on every keystroke while someone is still picking dates, so deps stay empty.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    generate(start, end, employeeId);
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(start, end, employeeId);
  }

  // Round five (CB): "when I click into the name and then I slide back, it's like it's going
  // to the team schedule, but it should go back to like the all team members" — switching into
  // a single person's report never touched browser history before, so a back gesture skipped
  // straight past "all team members" to whatever page was open before Reports. Pushing a real
  // history entry here (and restoring it on popstate below) makes "back" land on the
  // all-team-members view first, like any other drill-down/back pair in this app.
  function handleEmployeeChange(id: string) {
    setEmployeeId(id);
    generate(start, end, id);
    const url = id ? `${window.location.pathname}?employeeId=${id}` : window.location.pathname;
    window.history.pushState({ employeeId: id }, "", url);
  }

  useEffect(() => {
    function onPopState(ev: PopStateEvent) {
      const id = (ev.state?.employeeId as string | undefined) ?? "";
      setEmployeeId(id);
      generate(start, end, id);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [start, end]);

  function useThisWeek() {
    const week = thisWeekRange();
    setStart(week.start);
    setEnd(week.end);
    generate(week.start, week.end, employeeId);
  }

  function useThisMonth() {
    const s = firstOfMonth();
    const e = todayDateKey();
    setStart(s);
    setEnd(e);
    generate(s, e, employeeId);
  }

  function useLastTwoWeeks() {
    const range = lastTwoWeeksRange();
    setStart(range.start);
    setEnd(range.end);
    generate(range.start, range.end, employeeId);
  }

  const rangeInvalid = end < start;
  const exportQuery = `?start=${start}&end=${end}${employeeId ? `&employeeId=${employeeId}` : ""}`;

  // Round five (CB): "the download PDF and download CSV should be like kind of on the bottom
  // area" (both desktop and mobile) — moved out of the filter form, into its own row at the end
  // of whichever report is currently showing (the single-employee full report, or the
  // all-team-members list), so it reads as "export what I'm looking at" rather than cluttering
  // the Generate controls above.
  const exportActions = (
    <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-4 border-t border-border">
      <span className="text-xs text-muted mr-1">Export this report:</span>
      <a href={`/api/payroll/hours/csv${exportQuery}`} className="btn-neutral text-sm px-5 py-2">
        Download CSV
      </a>
      <a href={`/api/payroll/hours/pdf${exportQuery}`} className="btn-outline text-sm px-5 py-2">
        Download PDF
      </a>
    </div>
  );

  return (
    <div className="max-w-5xl">
      <h1 className="page-title text-2xl mb-1">Reports</h1>

      {/* "team" scope (a Supervisor) never sees this switcher at all — Activity History reads
          the org-wide audit trail, which stays admin-only (see this file's own doc comment), so
          there's nothing to switch to and no point showing a tab that would just be a dead end. */}
      {scope === "all" && (
        <div role="tablist" className="flex items-center gap-1 mb-5 border-b border-border">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "payroll"}
            onClick={() => setTab("payroll")}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === "payroll" ? "border-accent text-accent-ink" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Payroll Hours
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "activity"}
            onClick={() => setTab("activity")}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === "activity" ? "border-accent text-accent-ink" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Activity History
          </button>
        </div>
      )}

      {tab === "activity" ? (
        <ActivityHistoryView />
      ) : (
        <div>
      {/* Round five (CB): the table below needs the page's full width to lay out without a
          horizontal scrollbar — this paragraph keeps its own narrower measure so the
          explanatory copy stays easy to read instead of stretching edge to edge with it. */}
      <p className="text-sm text-muted mb-4 max-w-2xl">
        {scope === "team"
          ? "Approved hours for your own team, for a pay period. This is hours only — no pay rate, overtime, or tax math happens here."
          : "Approved hours for a pay period, ready to hand to your payroll company. This is hours only — no pay rate, overtime, or tax math happens here."}
      </p>

      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={useThisWeek} disabled={loadState === "loading"} className="btn-neutral text-xs px-3 py-1.5">
          This week
        </button>
        <button type="button" onClick={useThisMonth} disabled={loadState === "loading"} className="btn-neutral text-xs px-3 py-1.5">
          This month
        </button>
        {/* Round four (CB, Oct 2026): "a 'last 2 weeks' button... matching Shawn's biweekly
            payroll pull cadence" — see lastTwoWeeksRange's own doc comment above. */}
        <button type="button" onClick={useLastTwoWeeks} disabled={loadState === "loading"} className="btn-neutral text-xs px-3 py-1.5">
          Last 2 weeks
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-4 mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Team Member</label>
          <select
            value={employeeId}
            onChange={(ev) => handleEmployeeChange(ev.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent min-w-[180px]"
          >
            <option value="">All team members</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
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
          {/* Round four (CB, Oct 2026, on the mockup: "there should be a way that we could kind
              of view those entries that are not necessarily approved... so we could go back
              there"): the banner itself now expands into exactly which entries, each one
              linking straight to that person's Timesheet tab on the week it falls in
              (ReviewTimesheetView's own ?week= read) instead of just naming a count and leaving
              HR to go hunting through My Team by hand. */}
          {report.unapprovedEntryCount > 0 && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 mb-4 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowUnapproved((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-accent-ink text-left"
              >
                <span>
                  {report.unapprovedEntryCount} time {report.unapprovedEntryCount === 1 ? "entry" : "entries"} in
                  this period {report.unapprovedEntryCount === 1 ? "isn't" : "aren't"} approved yet, so{" "}
                  {report.unapprovedEntryCount === 1 ? "its" : "their"} hours aren&apos;t included below.
                </span>
                <span className="shrink-0 text-xs">{showUnapproved ? "▴" : "▾"}</span>
              </button>
              {showUnapproved && (
                <div className="border-t border-accent/20">
                  {report.unapprovedEntries.map((entry, i) => (
                    <a
                      key={`${entry.employeeId}-${entry.date}-${i}`}
                      href={`/team/${entry.employeeId}?week=${entry.date}`}
                      className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-accent/5 ${
                        i > 0 ? "border-t border-accent/10" : ""
                      }`}
                    >
                      <span>
                        <span className="font-semibold text-accent-ink">{entry.employeeName}</span>{" "}
                        <span className="text-muted">· {formatShortDate(entry.date)}</span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-accent-ink">Review →</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {employeeId !== "" && report.rows[0] ? (
            // Round four (CB, Oct 2026: "i should be able to see the full report when clicking
            // their name or... view full report"): the same per-person identity-banner shell
            // TeamScheduleView's own single-employee view already uses, so clicking into one
            // person reads as a distinct "here's their full report" screen rather than just a
            // shorter version of the same list.
            <div>
              <button
                type="button"
                onClick={() => handleEmployeeChange("")}
                className="text-sm font-medium text-muted hover:text-accent-ink mb-3"
              >
                ← All team members
              </button>
              <div
                className="rounded-2xl overflow-hidden shadow-sm mb-4 p-5"
                style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
              >
                <div className="flex items-center gap-3.5 flex-wrap">
                  <span className="h-12 w-12 rounded-xl bg-white shrink-0 flex items-center justify-center">
                    <span className="font-serif font-bold text-base text-accent-ink">
                      {initialsOf(report.rows[0].name) || "?"}
                    </span>
                  </span>
                  <div className="min-w-0">
                    <p className="font-serif text-lg font-bold text-white truncate">{report.rows[0].name}</p>
                    <p className="text-sm text-white/85 truncate">
                      {report.rows[0].employeeCode} · {report.rows[0].jobTitle}
                    </p>
                  </div>
                  <div className="ml-auto text-right shrink-0">
                    <p className="text-xs text-white/70">Period</p>
                    <p className="text-sm font-semibold text-white/90">{formatWeekRange(report.startDate, report.endDate)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                {[
                  { label: "Regular", value: report.rows[0].regularHours },
                  { label: "Vacation", value: report.rows[0].vacationHours },
                  { label: "Sick", value: report.rows[0].sickHours },
                  { label: "Personal", value: report.rows[0].personalHours },
                  { label: "Other Leave", value: report.rows[0].otherLeaveHours },
                ].map((line) => (
                  <div key={line.label} className="flex items-center justify-between px-5 py-3 border-b border-border text-sm">
                    <span className="text-muted">{line.label}</span>
                    <span className="font-semibold tabular-nums">{line.value.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-5 py-3.5 bg-accent/5 text-sm">
                  <span className="font-semibold text-accent-ink">Total</span>
                  <span className="font-semibold text-accent-ink text-base tabular-nums">
                    {report.rows[0].totalHours.toFixed(2)}
                  </span>
                </div>
              </div>
              {exportActions}
            </div>
          ) : (
            <div>
              {/* CB, round four: "that bottom half where you see the different team members...
                  needs to read a little bit more cleanly in a widget format... I shouldn't have
                  to slide to the left or right." Below md, this card list replaces the table
                  entirely (no horizontal scroll); at md and up the original table takes over. */}
              <div className="md:hidden space-y-2.5">
                {report.rows.map((row) => (
                  <div key={row.employeeId} className="bg-surface border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => handleEmployeeChange(row.employeeId)}
                          className="font-medium text-accent-ink underline decoration-accent-ink/30 underline-offset-2 truncate text-left"
                        >
                          {row.name}
                        </button>
                        <p className="text-xs text-muted mt-0.5">
                          {row.employeeCode} · {row.jobTitle}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted">Total</p>
                        <p className="text-base font-semibold tabular-nums">{row.totalHours.toFixed(2)}</p>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm border-t border-border pt-3">
                      <div className="flex items-center justify-between">
                        <dt className="text-xs text-muted">Regular</dt>
                        <dd className="tabular-nums">{row.regularHours.toFixed(2)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-xs text-muted">Vacation</dt>
                        <dd className="tabular-nums">{row.vacationHours.toFixed(2)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-xs text-muted">Sick</dt>
                        <dd className="tabular-nums">{row.sickHours.toFixed(2)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-xs text-muted">Personal</dt>
                        <dd className="tabular-nums">{row.personalHours.toFixed(2)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-xs text-muted">Other Leave</dt>
                        <dd className="tabular-nums">{row.otherLeaveHours.toFixed(2)}</dd>
                      </div>
                    </dl>
                    <div className="flex justify-end mt-2.5 pt-2.5 border-t border-border">
                      <button
                        type="button"
                        onClick={() => handleEmployeeChange(row.employeeId)}
                        className="text-xs font-semibold text-accent-ink"
                      >
                        View full report →
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted uppercase tracking-wide">
                      <th className="px-4 py-2.5 font-medium">Team Member</th>
                      <th className="px-4 py-2.5 font-medium">Job Title</th>
                      <th className="px-4 py-2.5 font-medium text-right">Regular</th>
                      <th className="px-4 py-2.5 font-medium text-right">Vacation</th>
                      <th className="px-4 py-2.5 font-medium text-right">Sick</th>
                      <th className="px-4 py-2.5 font-medium text-right">Personal</th>
                      <th className="px-4 py-2.5 font-medium text-right">Other Leave</th>
                      <th className="px-4 py-2.5 font-medium text-right">Total</th>
                      <th className="px-4 py-2.5 font-medium text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.rows.map((row) => (
                      <tr key={row.employeeId}>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => handleEmployeeChange(row.employeeId)}
                            className="font-medium text-accent-ink underline decoration-accent-ink/30 underline-offset-2"
                          >
                            {row.name}
                          </button>
                          <p className="text-xs text-muted">{row.employeeCode}</p>
                        </td>
                        <td className="px-4 py-2.5 text-muted">{row.jobTitle}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.regularHours.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.vacationHours.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.sickHours.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.personalHours.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.otherLeaveHours.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{row.totalHours.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleEmployeeChange(row.employeeId)}
                            className="text-xs font-semibold text-accent-ink whitespace-nowrap"
                          >
                            View full report →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {exportActions}
            </div>
          )}
        </div>
      )}
        </div>
      )}
    </div>
  );
}
