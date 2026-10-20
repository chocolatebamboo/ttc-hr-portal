"use client";

import { useEffect, useState } from "react";
import { getPayrollPeriod, getCurrentPayrollPeriodOffset, payrollPeriodOffsetForDate, formatWeekRange } from "@/lib/week";
import { formatClockTime } from "@/lib/time";
import PayrollPeriodSwitcher from "@/components/PayrollPeriodSwitcher";
import ActivityHistoryView from "./ActivityHistoryView";
import type { PayrollHoursReportDTO, TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";
type EmployeeOption = { id: string; name: string };

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

// Round twelve (CB, Oct 2026, screenshotting the bottom of this page: "can we see that
// celebration thing that we created again... I just wanted to be aesthetic so that section kind
// of stand[s] out like the download button"): the export row below now reuses the exact
// gradient/seal/confetti treatment from the Home dashboard's "Two-week report is ready" card
// (ReportReadyBanner in DashboardNotifications.tsx) — same .report-ready-glow/-seal/-seal-ring/
// -confetti-piece/-sparkle classes from globals.css, which are named generically (not
// dashboard-specific) and were left untouched rather than re-opening that already-shipped file.
// The confetti-burst geometry itself is a local copy of that banner's own fixed, non-randomized
// 16-piece math (so this renders identically server/client with no hydration mismatch, same
// reasoning as the original) rather than importing DashboardNotifications.tsx's private helpers —
// same local-copy convention this file already follows for initialsOf above. Confirmed with CB
// that the burst replaying each time this block mounts (switching between the all-team-members
// list and a single employee's report) is fine as-is, no toned-down no-confetti variant needed.
const REPORT_EXPORT_CONFETTI_COLORS = ["#ffffff", "#ffd166", "#ed008c", "#8ecae6"];
const REPORT_EXPORT_CONFETTI = Array.from({ length: 16 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 16 + ((i % 3) - 1) * 0.08;
  const dist = 55 + ((i * 37) % 70);
  const dx = Math.cos(angle) * dist;
  const dy = Math.sin(angle) * dist * 0.6 - 12;
  return {
    color: REPORT_EXPORT_CONFETTI_COLORS[i % REPORT_EXPORT_CONFETTI_COLORS.length],
    end: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`,
    rot: `${(i * 53) % 360}deg`,
    delay: `${0.05 + ((i * 7) % 20) / 100}s`,
  };
});
const REPORT_EXPORT_SPARKLES = [
  { left: 5, top: 10, size: 11, delay: "0.6s" },
  { left: 55, top: 4, size: 8, delay: "0.72s" },
  { left: 175, top: 16, size: 9, delay: "0.84s" },
];

type ExportConfettiPieceStyle = React.CSSProperties & {
  "--report-ready-end": string;
  "--report-ready-rot": string;
};

function ReportExportConfetti() {
  return (
    <>
      {REPORT_EXPORT_CONFETTI.map((piece, i) => (
        <span
          key={i}
          className="report-ready-confetti-piece"
          aria-hidden="true"
          style={
            {
              left: "37px",
              background: piece.color,
              animationDelay: piece.delay,
              "--report-ready-end": piece.end,
              "--report-ready-rot": piece.rot,
            } as ExportConfettiPieceStyle
          }
        />
      ))}
      {REPORT_EXPORT_SPARKLES.map((s, i) => (
        <span
          key={i}
          className="report-ready-sparkle"
          aria-hidden="true"
          style={{ left: s.left, top: s.top, animationDelay: s.delay }}
        >
          <svg width={s.size} height={s.size} viewBox="0 0 24 24" fill="white">
            <path d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4z" />
          </svg>
        </span>
      ))}
    </>
  );
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
  // Round eleven (CB, Oct 2026, on a phone screenshot of the old "This Week"/"This Month"/
  // "2 Week Report" buttons plus a manual Start date/End date/Generate form: "I don't
  // necessarily feel like [picking which days] is the right functionality for it... I think I
  // wanna see it in two week intervals and we just could be able to switch in between the
  // different pay periods... current or the past one"). Every interval this report can ever
  // show is now one of TTC's real payroll periods — this one offset (relative to
  // getCurrentPayrollPeriodOffset, same "0 = today's own period, negative = past" convention
  // My Tasks/Team Tasks/LoggedHoursSection already page by) is the only thing left to track;
  // start/end below are just the derived boundary dates for whichever offset is selected.
  const [periodOffset, setPeriodOffset] = useState(getCurrentPayrollPeriodOffset);
  const { start, end } = getPayrollPeriod(periodOffset);
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
  // Round six (CB): "once we click into their name, I should be able to see... their full
  // actual schedule, not just the hours, but the different schedules cleanly as a drop down" —
  // scoped down to "each worked day's hours" (date, clock-in/out times, hours). Lazily loaded
  // the first time it's opened for a given employee/period, not fetched up front with the rest
  // of the report — most visits to a person's full report never open this. null = not fetched
  // yet for the current employeeId/start/end; generate() below resets it to null whenever any
  // of those change, so switching people or dates never shows stale days.
  const [regularExpanded, setRegularExpanded] = useState(false);
  const [regularEntries, setRegularEntries] = useState<TimeEntryDTO[] | null>(null);
  const [regularLoading, setRegularLoading] = useState(false);
  const [regularError, setRegularError] = useState("");
  // Round six (CB): "I kind of want to drop down so we could look at the other team members...
  // without having to go all the way back to the full team page." Reuses the same `employees`
  // list and handleEmployeeChange the Team Member picker up top already has — this is just a
  // second entry point into the exact same switch, placed where CB's eyes already are once
  // she's deep in one person's report. Reset to closed on every generate() (same reasoning as
  // regularExpanded above): switching people or dates should never leave a stale open panel.
  const [switcherOpen, setSwitcherOpen] = useState(false);

  async function generate(s: string, e: string, empId: string) {
    setLoadState("loading");
    setErrorMessage("");
    setRegularExpanded(false);
    setRegularEntries(null);
    setRegularError("");
    setSwitcherOpen(false);
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

  /** Toggles the day-by-day panel under "Regular" on the single-employee report, fetching the
   *  period's time entries (reusing the same endpoint ReviewTimesheetView's own Timesheet tab
   *  already calls — see that route's own doc comment) the first time it's opened, then just
   *  toggling visibility on every tap after that. Only APPROVED entries with at least one
   *  session are shown — anything else contributed nothing to the Regular total above, so
   *  listing it here would make the breakdown's own sum not match the number it's explaining. */
  async function toggleRegularBreakdown() {
    const next = !regularExpanded;
    setRegularExpanded(next);
    if (next && regularEntries === null && employeeId) {
      setRegularLoading(true);
      setRegularError("");
      try {
        const res = await fetch(`/api/time/timesheet?employeeId=${employeeId}&start=${start}&end=${end}`);
        if (!res.ok) throw new Error();
        const data: { entries: TimeEntryDTO[] } = await res.json();
        setRegularEntries(data.entries.filter((entry) => entry.status === "APPROVED" && entry.sessions.length > 0));
      } catch {
        setRegularError("Unable to load the day-by-day breakdown. Please try again.");
      } finally {
        setRegularLoading(false);
      }
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

  // Initial load only — every regeneration after this happens through handleEmployeeChange or
  // handlePeriodOffsetChange below, so deps stay empty.
  //
  // Round twelve (CB, Oct 2026): the Home dashboard's report-ready celebration card's own "View
  // report" button links here with `?periodEnd=<date>` — same `window.location.search` read +
  // clear-after-read + `payrollPeriodOffsetForDate` convention ReviewTimesheetView's own `?week=`
  // deep link already uses (see that file's own doc comment), translated to pay-period offsets
  // instead of calendar weeks. Folded into this same effect, rather than a separate one, because
  // periodOffset here isn't reactive the way ReviewTimesheetView's offset is — generate() has to
  // be called directly either way (see handlePeriodOffsetChange below), so a second effect
  // competing to call it on the same mount would just race this one.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const periodEndParam = params.get("periodEnd");
    if (periodEndParam) {
      const offset = payrollPeriodOffsetForDate(periodEndParam);
      const range = getPayrollPeriod(offset);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPeriodOffset(offset);
      generate(range.start, range.end, employeeId);
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      generate(start, end, employeeId);
    }
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** Round eleven (CB, Oct 2026) — see this file's own doc comment on periodOffset above for
   *  the full story. Every interval this report can show is now one of TTC's real payroll
   *  periods, so paging is just moving periodOffset by one (getPayrollPeriod, src/lib/week.ts,
   *  already knows exactly where one period ends and the next begins — no more hand-computing a
   *  step size). Shared by both the top-level controls and the single-employee card below via
   *  the same PayrollPeriodSwitcher component the rest of the app already pages pay periods
   *  with (My Tasks, Team Tasks, LoggedHoursSection). */
  function handlePeriodOffsetChange(newOffset: number) {
    setPeriodOffset(newOffset);
    const range = getPayrollPeriod(newOffset);
    generate(range.start, range.end, employeeId);
  }

  // Round thirteen — see the top filter bar's own doc comment below for the full story. True
  // only once the single-employee pink identity card is actually on screen (it has its own
  // Team Member switcher and PayrollPeriodSwitcher), so the top bar can hide without leaving any
  // other state (all-team-members, loading, empty, error) without a way to change who/when.
  const showingSingleEmployeeReport = loadState === "ready" && !!report && employeeId !== "" && !!report.rows[0];

  const exportQuery = `?start=${start}&end=${end}${employeeId ? `&employeeId=${employeeId}` : ""}`;

  // Round five (CB): "the download PDF and download CSV should be like kind of on the bottom
  // area" (both desktop and mobile) — moved out of the filter form, into its own row at the end
  // of whichever report is currently showing (the single-employee full report, or the
  // all-team-members list), so it reads as "export what I'm looking at" rather than cluttering
  // the Generate controls above.
  //
  // Round six (CB, on a mobile screenshot): "the download PDF and CSV is like stacked on top of
  // each other... need them to be all on the same plane." The label + two full-size buttons
  // never fit one row at phone width, so flex-wrap was dropping each onto its own line. Below
  // sm, the label moves above as its own line and the two buttons split one row evenly
  // (flex-1, smaller padding so they fit); at sm and up this collapses back to the original
  // single inline row, label included.
  //
  // Round twelve (CB): see this file's doc comment above ReportExportConfetti for the full
  // story — this plain bordered strip became the same celebration card as the dashboard's
  // report-ready banner. Single-employee view already shows the person's name in the card
  // above, so the subtitle here is just the pay period; the all-team-members view has no name
  // of its own in view, so its subtitle adds the team-member count the way the mockup did.
  const periodLabel = formatWeekRange(start, end);
  const exportSubtitle = employeeId
    ? periodLabel
    : `${periodLabel} · ${report?.rows.length ?? 0} team ${(report?.rows.length ?? 0) === 1 ? "member" : "members"}`;
  const exportActions = (
    <div
      className="report-ready-card relative mt-4 overflow-hidden rounded-3xl px-[15px] py-4 text-white"
      style={{
        boxShadow: "0 10px 30px -6px color-mix(in srgb, var(--ttc-pink-ink) 45%, transparent), 0 2px 8px rgba(0,0,0,0.08)",
        background:
          "radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,0.16), transparent 55%), linear-gradient(135deg, var(--ttc-blue-ink) 0%, var(--ttc-blue) 48%, var(--ttc-pink) 100%)",
      }}
    >
      <span className="report-ready-glow" aria-hidden="true" />
      <ReportExportConfetti />
      <div className="relative z-[2] flex items-center gap-[11px]">
        <span className="relative shrink-0">
          <span className="report-ready-seal-ring absolute -inset-1 rounded-full border-[1.5px] border-white/50" aria-hidden="true" />
          <span className="report-ready-seal flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.16)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ttc-pink-ink)" strokeWidth="2.2" aria-hidden="true">
              <path d="M12 3v13" strokeLinecap="round" />
              <path d="M7 11l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 20h16" strokeLinecap="round" />
            </svg>
          </span>
        </span>
        <div className="min-w-0">
          <div className="font-serif text-[1.3rem] font-bold leading-[1.14] tracking-[-0.01em] truncate">Export this report</div>
          <div className="mt-[3px] truncate text-[0.86rem] text-white/80">{exportSubtitle}</div>
        </div>
      </div>
      <div className="relative z-[2] my-3.5 h-px bg-white/20" />
      <div className="relative z-[2] flex items-center gap-2">
        <a
          href={`/api/payroll/hours/csv${exportQuery}`}
          className="flex-1 text-center rounded-full bg-white px-3 py-2.5 text-sm font-bold text-[color:var(--ttc-pink-ink)]"
        >
          Download CSV
        </a>
        <a
          href={`/api/payroll/hours/pdf${exportQuery}`}
          className="flex-1 text-center rounded-full border-[1.5px] border-white/55 px-3 py-2.5 text-sm font-bold text-white"
        >
          Download PDF
        </a>
      </div>
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

      {/* Round eleven (CB, Oct 2026, on a phone screenshot of this exact row + form: "I don't
          necessarily feel like [picking which days] is the right functionality for it... I
          think I wanna see it in two week intervals and we just could be able to switch in
          between the different pay periods... current or the past one"): "This week"/"This
          month"/"2 Week Report" plus a manual Start date/End date/Generate form let someone
          land on a stretch that isn't one of TTC's real payroll periods at all — exactly what
          she didn't want from a report that's handed straight to payroll. Replaced with just
          paging PayrollPeriodSwitcher's own offset (see handlePeriodOffsetChange above); there's
          no other interval to pick anymore, so Team Member and the period switcher are the
          whole control surface, and nothing needs an explicit Generate click — both already
          regenerate the report the moment either one changes.

          Round thirteen (CB, Oct 2026, on a phone screenshot of this exact card with a single
          employee's full report open below it, red-X'd out: "it's kind of redundant because we
          already have that functionality below"): once a single employee's report is showing,
          the pink identity card right below already offers both the same controls — the name
          itself opens the same employee switcher (see switcherOpen above), and its own
          PayrollPeriodSwitcher pages the same period — so this bar is hidden for that one case.
          It still renders for every other state (the all-team-members list, and the
          loading/empty/error states for a single employee, none of which show that pink card),
          since those have no other way to change who or which period is showing. */}
      {!showingSingleEmployeeReport && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-5 flex flex-wrap items-center justify-between gap-4">
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
          <PayrollPeriodSwitcher offset={periodOffset} onOffsetChange={handlePeriodOffsetChange} capNextAtCurrent />
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

          {showingSingleEmployeeReport ? (
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
                // Round ten (CB, on this card's own "2-WEEK REPORT" preset dropdown: "I'm
                // noticing that the drop-down here isn't responding well"): the toggle itself was
                // fine — the real bug was this card's own `overflow-hidden`, kept here on the
                // mistaken assumption the gradient `background` below needed it clipped to the
                // rounded corners. It never did (a `background` always honors `border-radius` on
                // its own element, with or without `overflow`); what that `overflow-hidden`
                // actually did was clip the period-preset dropdown's own absolutely-positioned
                // menu (below, `top-full`) the moment it opened near this card's bottom edge,
                // hiding everything past "This Week" — exactly CB's screenshot. Dropped so the
                // menu can render in full; it floats over the table beneath on open (z-10) the
                // same way any dropdown menu does, and the card's rounded corners and gradient
                // are unaffected. (Round eleven: that period-preset dropdown is gone now — see
                // PayrollPeriodSwitcher below — but the employee-switcher dropdown right above it
                // still benefits from the same unclipped overflow, so this stays dropped.)
                className="rounded-2xl shadow-sm mb-4 p-5"
                style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
              >
                <div className="flex items-center gap-3.5">
                  <span className="h-12 w-12 rounded-xl bg-white shrink-0 flex items-center justify-center">
                    <span className="font-serif font-bold text-base text-accent-ink">
                      {initialsOf(report.rows[0].name) || "?"}
                    </span>
                  </span>
                  <div className="min-w-0">
                    {/* Round six (CB): "I kind of want to drop down so we could look at the
                        other team members... without having to go all the way back to the full
                        team page." The name itself is the control (CB, on a first version of
                        this with a separate "Switch to" row next to "← All team members": "I
                        feel like there's a better way... reads cleanly") — one dropdown next to
                        the name to jump to a specific person, one link above to leave the
                        single-person view entirely, instead of two nav controls stacked in one
                        thin strip doing similar-feeling things. */}
                    <button
                      type="button"
                      onClick={() => setSwitcherOpen((v) => !v)}
                      aria-expanded={switcherOpen}
                      className="flex items-center gap-1.5 max-w-full"
                    >
                      <span className="font-serif text-lg font-bold text-white truncate">{report.rows[0].name}</span>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="3"
                        aria-hidden="true"
                        className={`shrink-0 opacity-80 transition-transform ${switcherOpen ? "rotate-180" : ""}`}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    <p className="text-sm text-white/85 truncate">
                      {report.rows[0].employeeCode} · {report.rows[0].jobTitle}
                    </p>
                  </div>
                </div>
                {switcherOpen && (
                  <div className="mt-3 bg-white rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                    {employees.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => handleEmployeeChange(emp.id)}
                        className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left border-t border-border first:border-t-0 ${
                          emp.id === employeeId
                            ? "bg-accent/10 text-accent-ink font-semibold"
                            : "text-foreground hover:bg-black/[0.02]"
                        }`}
                      >
                        <span
                          className={`h-[22px] w-[22px] rounded-md shrink-0 flex items-center justify-center text-[9px] font-bold ${
                            emp.id === employeeId ? "bg-accent-ink text-white" : "bg-border text-muted"
                          }`}
                        >
                          {initialsOf(emp.name) || "?"}
                        </span>
                        {emp.name}
                      </button>
                    ))}
                  </div>
                )}
                {/* Round eleven (CB, Oct 2026) — same PayrollPeriodSwitcher as the top-level
                    controls above; see this file's own doc comment there for the full story.
                    This single-employee card no longer offers This Week/This Month or a
                    period-preset dropdown of its own — a payroll period, current or past, is
                    the only thing either view of this report ever shows now, so paging here and
                    paging up top can never disagree with each other. */}
                <div className="mt-4 pt-3.5 border-t border-white/20">
                  <PayrollPeriodSwitcher offset={periodOffset} onOffsetChange={handlePeriodOffsetChange} capNextAtCurrent />
                </div>
              </div>

              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                {/* Round six (CB): "once we click into their name, I should be able to see...
                    their full actual schedule, not just the hours, but the different schedules
                    cleanly as a drop down so that we could see the context of each one" —
                    scoped to "each worked day's hours." Only Regular breaks down like this
                    (Vacation/Sick/Personal/Other Leave stay plain totals below) since Regular is
                    the one number built from a list of individual worked days in the first
                    place — see toggleRegularBreakdown's own doc comment above. */}
                {/* Round six (CB, on a screenshot of the collapsed row): "I'm still not seeing
                    the drop down... currently it's just showing the hours but I don't see that
                    breakdown" — the feature itself was already live, but the only sign it was
                    clickable was a 10px character next to "Regular," identical in weight to the
                    plain (non-interactive) Vacation/Sick/Personal/Other Leave rows right below
                    it. A tinted background, an explicit "View days" label, and a real chevron
                    icon (rather than a tiny ▾/▴ glyph that doesn't reliably render the same way
                    across devices/fonts) now mark this one row as a button, not just text. */}
                <button
                  type="button"
                  onClick={toggleRegularBreakdown}
                  aria-expanded={regularExpanded}
                  className="w-full flex items-center justify-between px-5 py-3 border-b border-border text-sm text-left bg-accent/5 hover:bg-accent/10 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">Regular</span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink">
                      View days
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        aria-hidden="true"
                        className={`transition-transform ${regularExpanded ? "rotate-180" : ""}`}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{report.rows[0].regularHours.toFixed(2)}</span>
                </button>
                {regularExpanded && (
                  <div className="px-5 py-2.5 border-b border-border bg-accent/[0.03]">
                    {regularLoading && <p className="text-xs text-muted py-1.5">Loading…</p>}
                    {regularError && <p className="text-xs text-accent py-1.5">{regularError}</p>}
                    {!regularLoading && !regularError && regularEntries && regularEntries.length === 0 && (
                      <p className="text-xs text-muted py-1.5">No approved worked days in this period.</p>
                    )}
                    {!regularLoading &&
                      regularEntries &&
                      regularEntries.map((entry, i) => (
                        <div
                          key={entry.id}
                          className={`flex items-center justify-between gap-3 py-2 text-xs ${i > 0 ? "border-t border-border" : ""}`}
                        >
                          {/* CB: "right now I'm seeing invalid date" — entry.workDate here is the
                              full ISO datetime string the API returns, not a bare "YYYY-MM-DD"
                              key; formatShortDate (above) builds a Date from `${dateKey}T00:00:00`,
                              which only parses correctly off the sliced date. Every other
                              .workDate consumer in this app already slices to the first 10
                              characters before using it as a date key (TimesheetTable,
                              TimesheetView, LoggedHoursSection, TimesheetCalendar, payroll.ts,
                              attendance-admin.ts, shifts.ts) — this was the one outlier. */}
                          <span className="font-medium min-w-[88px] shrink-0">{formatShortDate(entry.workDate.slice(0, 10))}</span>
                          <span className="text-muted flex-1 px-2">
                            {entry.sessions.map((s) => `${formatClockTime(s.clockIn)} – ${formatClockTime(s.clockOut)}`).join(", ")}
                          </span>
                          <span className="tabular-nums font-medium shrink-0">
                            {entry.totalMinutes != null ? (entry.totalMinutes / 60).toFixed(2) : "—"}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                {[
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
