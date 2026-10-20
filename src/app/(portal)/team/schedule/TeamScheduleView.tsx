"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import DateTasksPanel from "@/components/DateTasksPanel";
import PayrollPeriodSwitcher from "@/components/PayrollPeriodSwitcher";
import { ChartIcon, ChecklistIcon, ChevronDownIcon } from "@/components/icons";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import { todayDateKey } from "@/lib/time";
import { formatWeekRange, getPayrollPeriodWeeks, payrollPeriodOffsetForDate } from "@/lib/week";
import type { AdminShiftDTO, AssignmentOptionsDTO, DateTaskDTO, DirectReportDTO, ShiftStatus } from "@/types";

type LoadState = "loading" | "ready" | "error";

type EmployeeOption = { id: string; name: string };

/** One person's card in the grouped (all-team-members) view — see groupByPerson below. */
type GroupedShifts = {
  employeeId: string;
  name: string;
  jobTitle: string;
  avatarUrl: string | null;
  shifts: AdminShiftDTO[];
  missedCount: number;
};

/** Round 2 (CB, Oct 2026, on the mockup: "I don't like how it's showing up the same name
 *  multiple times... they're supposed to be organized per profile"): groups a shift list by
 *  person instead of one flat, repeating-name list. Group order follows first appearance in
 *  `weekShifts` (already still-coming-first/date-ordered — see byShiftPriority above), same as
 *  the approved mockup. Round 5: pulled out to module scope (was a useMemo inside the component)
 *  so TeamScheduleView can call it once per week instead of once for the whole period — see that
 *  component's own week1Grouped/week2Grouped. */
function groupByPerson(weekShifts: AdminShiftDTO[], employeeFilter: string): GroupedShifts[] {
  if (employeeFilter !== "") return [];
  const order: string[] = [];
  const byEmployee = new Map<string, AdminShiftDTO[]>();
  for (const s of weekShifts) {
    if (!byEmployee.has(s.employeeId)) {
      byEmployee.set(s.employeeId, []);
      order.push(s.employeeId);
    }
    byEmployee.get(s.employeeId)!.push(s);
  }
  return order.map((id) => {
    const group = byEmployee.get(id)!;
    return {
      employeeId: id,
      name: group[0].employeeName,
      jobTitle: group[0].employeeJobTitle,
      avatarUrl: group[0].employeeAvatarUrl,
      shifts: group,
      missedCount: group.filter((s) => s.displayStatus === "MISSED").length,
    };
  });
}

const STATUS_OPTIONS: ShiftStatus[] = [
  "UPCOMING",
  "IN_PROGRESS",
  "COMPLETED",
  "CHANGE_REQUESTED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
  "REASSIGNED",
  "MISSED",
];

function reportName(r: DirectReportDTO): string {
  return `${r.preferredName || r.firstName} ${r.lastName}`;
}

// Same local-copy convention every other consumer of "initials from a name" already follows in
// this app (see TeamScheduleGlance.tsx's own doc comment on this exact choice) — used below for
// the single-employee banner's avatar.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/** Round 5 (CB, Oct 2026: "I need to see it in the 2 week intervals as well... the same type of
 *  vibe... the same drop downs as well"): which of a pay period's two weeks should start open —
 *  the week containing `targetDate` (today, normally; a specific deep-linked date on first load
 *  via the ?dateFrom= effect below), falling back to Week 1 when `targetDate` falls in neither
 *  (viewing a period that doesn't contain it at all). Same helper, same reasoning, as
 *  ReviewTimesheetView's own defaultOpenWeeks — kept as its own small local copy here rather
 *  than a shared export, same "don't re-touch an already-shipped file for a non-functional
 *  dedup" call this app already makes elsewhere (see PayrollPeriodSwitcher's own doc comment on
 *  LoggedHoursSection). */
function defaultOpenWeeks(offsetPeriods: number, targetDate: string): { open1: boolean; open2: boolean } {
  const weeks = getPayrollPeriodWeeks(offsetPeriods);
  if (weeks.week2.days.includes(targetDate)) return { open1: false, open2: true };
  return { open1: true, open2: false };
}

/** Round 3 (CB, Oct 2026, from the live page: "whoever is upcoming... whoever is closest to
 *  clock in, they will be the one to prioritize... they will go at the top... that profile... we
 *  make sure we prioritize that"): a shift that's already resolved one way or another (it
 *  happened, it was cancelled, it was handed to someone else, or nobody clocked in) is settled —
 *  there's nothing left to watch for. Everything else (UPCOMING, IN_PROGRESS, and a pending
 *  CHANGE_REQUESTED/CANCELLATION_REQUESTED, which is still a live shift awaiting a decision) is
 *  still "coming," so it's what this page is actually for keeping an eye on. Reads
 *  `displayStatus`, not the raw stored `status`, so a shift that quietly became MISSED overnight
 *  (deriveShiftDisplayStatus) drops out of the prioritized group the same way an explicitly
 *  CANCELLED one does — it's just as settled, even though nobody made that call directly. */
function isSettledShift(s: AdminShiftDTO): boolean {
  return (
    s.displayStatus === "COMPLETED" ||
    s.displayStatus === "CANCELLED" ||
    s.displayStatus === "REASSIGNED" ||
    s.displayStatus === "MISSED"
  );
}

/** CB's own words for this, above: not a full re-ranking of every status against every other
 *  (her "doesn't necessarily have to be every single one") — just a single still-coming/settled
 *  split, soonest start time first within each half. That's also plain chronological order, so a
 *  settled group reads exactly as it always has; only the "still coming" shifts actually move. */
function shiftSortKey(s: AdminShiftDTO): [number, string] {
  return [isSettledShift(s) ? 1 : 0, `${s.date}T${s.startTime}`];
}

function byShiftPriority(a: AdminShiftDTO, b: AdminShiftDTO): number {
  const [rankA, keyA] = shiftSortKey(a);
  const [rankB, keyB] = shiftSortKey(b);
  if (rankA !== rankB) return rankA - rankB;
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

/**
 * Team Schedule — phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): the
 * supervisor/admin-facing counterpart to My Schedule, plus the two actions that actually create
 * a confirmed shift ("Create a shift manually") and the two that change one after the fact
 * ("Reassign or cancel confirmed shifts"). Converting APPROVED availability into a shift lives
 * on the Team Availability page itself (right next to the submission it comes from), not here —
 * this page is for shifts that already exist, whichever way they were created.
 *
 * Filtering by team member/department/status/date happens client-side against one full fetch —
 * TTC's actual shift volume is small enough that a second round-trip per filter change would be
 * pure overhead; src/lib/shifts.ts's listAdminShifts still accepts real server-side filters for
 * whenever that stops being true.
 *
 * Oct 2026 (CB, on the Home dashboard's Upcoming widget: "when we click it we can see that
 * person's full schedule down the line," and separately, "if I click on see more then it should
 * go into another page"): `employeeFilter` (and, via payrollPeriodOffsetForDate, the initial
 * `offset`) seed themselves from this page's own URL — `?employeeId=<id>` (one Upcoming row) or
 * `?dateFrom=<date>` ("See all upcoming") — so TeamScheduleGlance's links can land here
 * pre-filtered instead of dumping an admin on an unfiltered, org-wide list they'd have to filter
 * themselves. Read straight off window.location.search in the mount effect below, not
 * next/navigation's useSearchParams, so this page doesn't need a Suspense boundary — same
 * reasoning MessagesInboxView.tsx's own dm/name URL read already documents. The filter
 * selects/period nav further down are still fully interactive afterward, so nothing about
 * adjusting or paging once here changes.
 *
 * Round 2 (CB, Oct 2026, on the mockup: "it should only be for the week... multiple pages," and
 * separately "I don't like how it's showing up the same name multiple times... organized per
 * profile"): the list used to be bounded to one Monday–Sunday week at a time, with prev/next nav
 * instead of the old free-form date-range filter. And whenever no single employee is picked,
 * shifts render grouped by person (`groupedByPerson` below) instead of repeating each person's
 * name on every card — approved via mockup first (her standing requirement for this kind of
 * visual change) before landing here.
 *
 * Round 5 (CB, Oct 2026, on this exact page: "I need to see it in the 2 week intervals as well...
 * the same type of vibe... that there's a drop down to see... that first week and then... the
 * second week... I want you to make sure that... it has those same drop downs as well... I also
 * should see kind of something similar to where we could see that 2 week report" — same request,
 * same approved design, as the Timesheet review page's own pay-period-accordion round): Round 2's
 * single-calendar-week paging is now a whole PAY PERIOD at a time (`offset` + getPayrollPeriodWeeks,
 * same PayrollPeriodSwitcher pill the Timesheet page/My Tasks/Logged hours already use), with a
 * "2-week report" link next to it (same `?periodEnd=` convention the Timesheet page's own summary
 * card and the Team Availability page's own button already use). Each of the period's two weeks
 * renders as its own collapsible section (ScheduleWeekBlock below) — whichever week contains the
 * relevant date (today, or a ?dateFrom= deep link below) starts open, both can be open at once —
 * with the single-employee/grouped-by-person view modes from Round 2 completely unchanged, just
 * rendered once per week instead of once for the whole period. Unlike the Timesheet page, the
 * "Next" arrow here still isn't capped at the current period — a shift can legitimately be
 * scheduled ahead of time, same as this page has always allowed.
 */
export default function TeamScheduleView({ viewerIsAdmin, viewerId }: { viewerIsAdmin: boolean; viewerId: string }) {
  const [shifts, setShifts] = useState<AdminShiftDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<{ id: string; name: string }[]>([]);
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);
  // Lets each shift row's Tasks toggle say what's actually there before it's opened (Add task /
  // View task / View tasks) instead of the same label regardless of state — approved via mockup
  // first. Keyed `${employeeId}__${date}` since the task list this is built from isn't scoped
  // to one shift — same employeeId+taskDate filter DateTasksPanel itself already applies
  // client-side against its own per-employee fetch.
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  // Round 4 (CB, Oct 2026, from a live screenshot of a 5-shift week: "make sure we're... [in] the
  // collapsed state... because I don't want it to look too cluttered"): each person's card in the
  // grouped (all-team-members) view now opens collapsed, same reasoning — and the same
  // collapsed-by-default Set<employeeId> pattern — as Team Tasks' own per-person cards
  // (src/app/(portal)/admin/tasks/TeamTasksView.tsx). The single-employee view (one person
  // already deliberately filtered to) is untouched; collapsing there would just hide the one
  // thing that view exists to show.
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const weeks = useMemo(() => getPayrollPeriodWeeks(offset), [offset]);
  // Round 5: which of the period's two weeks starts open — see defaultOpenWeeks's own doc
  // comment above.
  const [openWeeks, setOpenWeeks] = useState(() => defaultOpenWeeks(0, todayDateKey()));

  // Pages to a different pay period (prev/next/"Jump to current" on PayrollPeriodSwitcher) —
  // always resets the accordion to that period's own default-open week, never leaves whatever
  // was open/closed in the previous period showing stale state.
  function goToOffset(newOffset: number) {
    setOffset(newOffset);
    setOpenWeeks(defaultOpenWeeks(newOffset, todayDateKey()));
  }

  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  // Phase 2 (client spec, Sept 2026): responding to a pending CHANGE_REQUESTED/
  // CANCELLATION_REQUESTED — "Approve the request. Decline the request. Change the shift time.
  // Cancel the shift. Reassign the shift." The last two are already covered by
  // cancellingId/reassigningId above (extended to accept a pending-request shift, not just
  // UPCOMING); these three are the request-specific responses.
  const [approvingChangeId, setApprovingChangeId] = useState<string | null>(null);
  const [approveDate, setApproveDate] = useState("");
  const [approveStartTime, setApproveStartTime] = useState("");
  const [approveEndTime, setApproveEndTime] = useState("");
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineComment, setDeclineComment] = useState("");

  async function loadShifts() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/shifts");
      if (!res.ok) throw new Error();
      const data: { shifts: AdminShiftDTO[] } = await res.json();
      setShifts(data.shifts);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  async function loadOptions() {
    try {
      if (viewerIsAdmin) {
        const res = await fetch("/api/roster/assignable");
        if (!res.ok) return;
        const data: AssignmentOptionsDTO = await res.json();
        setEmployeeOptions(data.employees);
        setDepartmentOptions(data.departments);
      } else {
        const res = await fetch("/api/team/reports");
        if (!res.ok) return;
        const data: { reports: DirectReportDTO[] } = await res.json();
        setEmployeeOptions(data.reports.map((r) => ({ id: r.id, name: reportName(r) })));
      }
    } catch {
      // best-effort — an empty picker just means typing a filter isn't available yet
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadShifts();
    loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Oct 2026: picks up ?employeeId=/?dateFrom= from a TeamScheduleGlance link (see this
  // component's own doc comment above) and clears them from the URL right after, same "don't
  // keep re-applying a filter on every refresh" cleanup MessagesInboxView's own dm/name read
  // does — an admin who clears the filter manually afterward shouldn't have it silently come
  // back if they reload the page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const employeeId = params.get("employeeId");
    const dateFrom = params.get("dateFrom");
    if (!employeeId && !dateFrom) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (employeeId) setEmployeeFilter(employeeId);
    if (dateFrom) {
      const periodOffset = payrollPeriodOffsetForDate(dateFrom);
      setOffset(periodOffset);
      setOpenWeeks(defaultOpenWeeks(periodOffset, dateFrom));
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const filtered = useMemo(() => {
    return shifts.filter((s) => {
      if (employeeFilter && s.employeeId !== employeeFilter) return false;
      if (departmentFilter && s.departmentId !== departmentFilter) return false;
      if (statusFilter && s.displayStatus !== statusFilter) return false;
      if (s.date < weeks.period.start || s.date > weeks.period.end) return false;
      return true;
    });
  }, [shifts, employeeFilter, departmentFilter, statusFilter, weeks]);

  // Round 3 (CB, Oct 2026 — see byShiftPriority's own doc comment above): still-coming shifts
  // first, soonest first, settled ones after in their normal date order. Used for every actual
  // render below (the single-employee row list, and groupedByPerson's own build) — `filtered`
  // itself stays in the API's plain date order for the computations above that don't care about
  // display order (singleEmployeeInfo, the taskCounts fetch, isGroupedView).
  const prioritized = useMemo(() => [...filtered].sort(byShiftPriority), [filtered]);

  // Backs the Tasks toggle's wording (renderShiftRow below) — one fetch per visible employee
  // rather than one per shift, same "small enough that a second endpoint isn't worth it"
  // reasoning DateTasksPanel's own doc comment already gives for this exact endpoint. Re-runs
  // whenever the visible shift set changes (filters/week/a reload after an action) or a Tasks
  // panel opens or closes — the latter so a toggle's label picks up a task just added or
  // changed without threading a dedicated callback through DateTasksPanel/DateTaskRow.
  useEffect(() => {
    const ids = Array.from(new Set(filtered.map((s) => s.employeeId)));
    if (ids.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTaskCounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/date-tasks/${id}`);
            if (!res.ok) return;
            const data: { tasks: DateTaskDTO[] } = await res.json();
            for (const t of data.tasks) {
              const key = `${id}__${t.taskDate}`;
              counts[key] = (counts[key] ?? 0) + 1;
            }
          } catch {
            // best-effort — that employee's rows just keep the default "Add task" label
          }
        })
      );
      if (!cancelled) setTaskCounts(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [filtered, openShiftId]);

  // Oct 2026 (CB, after seeing the filtered-to-one-person view in production): she didn't like
  // that person's name repeating on every card below, and wanted the page "widgetized" and
  // clean for this case — approved via mockup first (her new standing requirement for this kind
  // of visual change) before this landed in real code. True only once an employee is picked AND
  // that filter actually matches something, so an empty result still falls through to the
  // ordinary empty state below rather than showing a banner for nobody.
  const isSingleEmployeeView = employeeFilter !== "" && filtered.length > 0;
  const singleEmployeeInfo = isSingleEmployeeView
    ? { name: filtered[0].employeeName, jobTitle: filtered[0].employeeJobTitle, avatarUrl: filtered[0].employeeAvatarUrl }
    : null;
  const singleEmployeeMissedCount = isSingleEmployeeView
    ? filtered.filter((s) => s.displayStatus === "MISSED").length
    : 0;

  // Round 2 (CB, Oct 2026, on the mockup: "I don't like how it's showing up the same name
  // multiple times... they're supposed to be organized per profile"): whenever no single
  // employee is picked, group shifts by person instead of one flat, repeating-name list. Group
  // order follows first appearance in the list it's built from (already date-ordered from the
  // API), same as the approved mockup.
  const isGroupedView = employeeFilter === "" && filtered.length > 0;

  // Round 5: splits the period's already-prioritized shift list into each of its two weeks —
  // `filter` preserves `prioritized`'s own still-coming-first order within each slice, so neither
  // week needs its own re-sort.
  const week1DaySet = useMemo(() => new Set(weeks.week1.days), [weeks]);
  const week2DaySet = useMemo(() => new Set(weeks.week2.days), [weeks]);
  const week1Shifts = useMemo(() => prioritized.filter((s) => week1DaySet.has(s.date)), [prioritized, week1DaySet]);
  const week2Shifts = useMemo(() => prioritized.filter((s) => week2DaySet.has(s.date)), [prioritized, week2DaySet]);
  // Round 5: `groupedByPerson` used to run once over the whole week's `prioritized` list; Team
  // Schedule now shows two weeks at once (one pay period), each its own accordion with its own
  // grouping — so groupByPerson (module scope, below the component) runs once per week here
  // instead of once for the whole period.
  const week1Grouped = useMemo(() => groupByPerson(week1Shifts, employeeFilter), [week1Shifts, employeeFilter]);
  const week2Grouped = useMemo(() => groupByPerson(week2Shifts, employeeFilter), [week2Shifts, employeeFilter]);

  function toggleEmployeeExpanded(employeeId: string) {
    setExpandedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  async function handleCreate(input: { employeeId: string; date: string; startTime: string; endTime: string; note: string }) {
    setActionError(null);
    try {
      const res = await fetch("/api/admin/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create that shift.");
      setShowCreate(false);
      loadShifts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't create that shift.");
    }
  }

  async function handleCancel(shiftId: string) {
    if (!cancelReason.trim()) return;
    setBusyId(shiftId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/shifts/${shiftId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't cancel that shift.");
      setCancellingId(null);
      setCancelReason("");
      loadShifts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't cancel that shift.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReassign(shiftId: string) {
    if (!reassignTo) return;
    setBusyId(shiftId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/shifts/${shiftId}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: reassignTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't reassign that shift.");
      setReassigningId(null);
      setReassignTo("");
      loadShifts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't reassign that shift.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveCancellation(shiftId: string) {
    setBusyId(shiftId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/shifts/${shiftId}/approve-cancellation`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't approve that cancellation.");
      loadShifts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't approve that cancellation.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveChange(shiftId: string) {
    setBusyId(shiftId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/shifts/${shiftId}/approve-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: approveDate || undefined,
          startTime: approveStartTime || undefined,
          endTime: approveEndTime || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't approve that change.");
      setApprovingChangeId(null);
      setApproveDate("");
      setApproveStartTime("");
      setApproveEndTime("");
      loadShifts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't approve that change.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeclineRequest(shiftId: string) {
    setBusyId(shiftId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/shifts/${shiftId}/deny-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: declineComment || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't decline that request.");
      setDecliningId(null);
      setDeclineComment("");
      loadShifts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't decline that request.");
    } finally {
      setBusyId(null);
    }
  }

  // Round 2 (CB, Oct 2026, on the mockup: "organized per profile"): the per-shift card used to
  // render differently depending on isSingleEmployeeView (date-only vs. name+date), because the
  // old multi-employee view was one flat list with the name repeated on every card. Now that the
  // multi-employee case groups by person instead (groupedByPerson below, each with its own name
  // header), every row is always the compact date-only variant — extracted here once so both the
  // single-employee list and every grouped-view card below share the exact same row, actions,
  // and Tasks panel rather than three copies of this markup.
  function renderShiftRow(s: AdminShiftDTO) {
    // Phase 2: Cancel/Reassign stay available on a pending CHANGE_REQUESTED/
    // CANCELLATION_REQUESTED shift too — the spec's own response options to a request include
    // "Change the shift time," "Cancel the shift," and "Reassign the shift," not only a plain
    // approve/decline (see SHIFT_RESOLVABLE_STATUSES in src/lib/shifts.ts).
    const canManage = s.status === "UPCOMING" || s.status === "CHANGE_REQUESTED" || s.status === "CANCELLATION_REQUESTED";
    const hasPendingRequest = s.status === "CHANGE_REQUESTED" || s.status === "CANCELLATION_REQUESTED";
    const isTasksOpen = openShiftId === s.id;
    const taskCount = taskCounts[`${s.employeeId}__${s.date}`] ?? 0;
    return (
      <div key={s.id} className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{formatSlotDate(s.date)}</p>
            <p className="text-sm text-muted">
              {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
            </p>
          </div>
          <ShiftStatusPill status={s.displayStatus} />
        </div>
        {s.note && <p className="text-sm text-muted italic mt-2">&ldquo;{s.note}&rdquo;</p>}
        {s.status === "CANCELLED" && s.cancelReason && (
          <p className="text-sm text-accent mt-2">Cancelled: {s.cancelReason}</p>
        )}

        {hasPendingRequest && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-sm">
            <p className="text-amber-800">
              {s.status === "CHANGE_REQUESTED" ? "Requested a change" : "Requested cancellation"}
              {s.changeReason ? `: "${s.changeReason}"` : "."}
            </p>
            {s.requestedDate && s.requestedStartTime && s.requestedEndTime && (
              <p className="text-amber-800 mt-1">
                Proposed: {formatSlotDate(s.requestedDate)}, {formatTime12h(s.requestedStartTime)} –{" "}
                {formatTime12h(s.requestedEndTime)}
              </p>
            )}
          </div>
        )}

        {s.status === "CANCELLATION_REQUESTED" && (
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => handleApproveCancellation(s.id)}
              disabled={busyId === s.id}
              className="text-xs font-medium text-accent-ink hover:underline"
            >
              Approve cancellation
            </button>
            <button
              type="button"
              onClick={() => {
                setDecliningId(decliningId === s.id ? null : s.id);
                setDeclineComment("");
              }}
              className="text-xs font-medium text-accent hover:underline"
            >
              Decline request
            </button>
          </div>
        )}

        {s.status === "CHANGE_REQUESTED" && (
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => {
                setApprovingChangeId(approvingChangeId === s.id ? null : s.id);
                setApproveDate(s.requestedDate ?? "");
                setApproveStartTime(s.requestedStartTime ?? "");
                setApproveEndTime(s.requestedEndTime ?? "");
              }}
              className="text-xs font-medium text-accent-ink hover:underline"
            >
              Approve change
            </button>
            <button
              type="button"
              onClick={() => {
                setDecliningId(decliningId === s.id ? null : s.id);
                setDeclineComment("");
              }}
              className="text-xs font-medium text-accent hover:underline"
            >
              Decline request
            </button>
          </div>
        )}

        {approvingChangeId === s.id && (
          <div className="mt-3 flex flex-col gap-2 bg-black/[0.03] rounded-xl p-3">
            <p className="text-xs text-muted">Confirm the final date and time for this shift:</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="date"
                value={approveDate}
                onChange={(e) => setApproveDate(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
              />
              <input
                type="time"
                value={approveStartTime}
                onChange={(e) => setApproveStartTime(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
              />
              <input
                type="time"
                value={approveEndTime}
                onChange={(e) => setApproveEndTime(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => handleApproveChange(s.id)}
              disabled={busyId === s.id || !approveDate || !approveStartTime || !approveEndTime}
              className="btn-outline text-xs px-3 py-1.5 self-start"
            >
              Confirm approval
            </button>
          </div>
        )}

        {decliningId === s.id && (
          <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-black/[0.03] rounded-xl p-3">
            <textarea
              value={declineComment}
              onChange={(e) => setDeclineComment(e.target.value)}
              placeholder="Optional note for the team member…"
              rows={2}
              className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent-ink"
            />
            <button
              type="button"
              onClick={() => handleDeclineRequest(s.id)}
              disabled={busyId === s.id}
              className="btn-outline text-xs px-3 py-1.5 self-start"
            >
              Confirm decline
            </button>
          </div>
        )}

        {canManage && (
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => {
                setCancellingId(cancellingId === s.id ? null : s.id);
                setReassigningId(null);
                setCancelReason("");
              }}
              className="text-xs font-medium text-accent hover:underline"
            >
              Cancel shift
            </button>
            <button
              type="button"
              onClick={() => {
                setReassigningId(reassigningId === s.id ? null : s.id);
                setCancellingId(null);
                setReassignTo("");
              }}
              className="text-xs font-medium text-accent-ink hover:underline"
            >
              Reassign
            </button>
          </div>
        )}

        {cancellingId === s.id && (
          <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-black/[0.03] rounded-xl p-3">
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancelling (required)…"
              rows={2}
              className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent-ink"
            />
            <button
              type="button"
              onClick={() => handleCancel(s.id)}
              disabled={busyId === s.id || !cancelReason.trim()}
              className="btn-outline text-xs px-3 py-1.5 self-start"
            >
              Confirm cancel
            </button>
          </div>
        )}

        {reassigningId === s.id && (
          <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-black/[0.03] rounded-xl p-3">
            <select
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              <option value="">Choose a team member…</option>
              {employeeOptions
                .filter((e) => e.id !== s.employeeId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => handleReassign(s.id)}
              disabled={busyId === s.id || !reassignTo}
              className="btn-outline text-xs px-3 py-1.5 self-start"
            >
              Confirm reassign
            </button>
          </div>
        )}

        {/* Phase 3 (client spec, Sept 2026): "re-point tasks and messages onto shifts instead of
            the original availability submission" — the same task list TeamAvailabilityCards
            already shows for an availability date, now on the shift itself. Correction brief #2
            (Sept 2026): each task now carries its own comment thread (DateTaskRow), replacing
            the standalone per-shift conversation that used to sit alongside this list — see
            DateTasksPanel's own doc comment. */}
        {/* Round 3 (CB, Oct 2026, on the mockup: too much going on — approved the plain
            version with no review annotations): says what's actually there before you open
            it instead of an unconditional "Tasks" — a count badge only shows once there's
            more than one, since "View task" already says there's exactly one. */}
        <button
          type="button"
          onClick={() => setOpenShiftId(isTasksOpen ? null : s.id)}
          className={`mt-3 flex items-center gap-1.5 text-xs font-medium transition-colors ${
            isTasksOpen
              ? "text-accent-ink"
              : taskCount > 0
                ? "text-accent-ink hover:opacity-80"
                : "text-muted hover:text-accent-ink"
          }`}
        >
          <ChecklistIcon className="h-3.5 w-3.5" />
          {taskCount === 0 ? "Add task" : taskCount === 1 ? "View task" : "View tasks"}
          {taskCount > 1 && (
            <span className="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-accent-ink text-white text-[10px] font-bold">
              {taskCount}
            </span>
          )}
        </button>

        {isTasksOpen && (
          <div className="mt-2.5 space-y-2.5">
            <div>
              <p className="text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                <ChecklistIcon className="h-3.5 w-3.5" />
                Tasks for this shift
              </p>
              <DateTasksPanel employeeId={s.employeeId} taskDate={s.date} viewerId={viewerId} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="page-title text-2xl">Team Schedule</h1>
        {/* CB, Oct 2026: "the button right now it's kinda looks scrunched in" — this was the one
            page-header .btn-primary in the app with no size classes of its own (.btn-primary
            carries no padding/font-size by default; every caller supplies it — see
            MessagesInboxView's "New message"/AnnouncementsView's compose button for the same
            title+button header shape), so it was rendering at whatever the surrounding text's
            size happened to be with zero padding. Matched to that same text-sm px-3.5 py-2 size
            other header-level primary buttons already use. */}
        <button
          type="button"
          className="btn-primary text-sm px-3.5 py-2 shrink-0"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Cancel" : "New shift"}
        </button>
      </div>
      <p className="text-sm text-muted mb-4">
        {viewerIsAdmin ? "Every confirmed shift, org-wide." : "Confirmed shifts for your own team."}{" "}
        To schedule someone from their approved availability, use Team Availability instead —
        this page is for shifts that already exist, and for creating one from scratch.
      </p>

      {showCreate && (
        <CreateShiftForm employeeOptions={employeeOptions} onCreate={handleCreate} error={actionError} />
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
        >
          <option value="">All team members</option>
          {employeeOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {viewerIsAdmin && (
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
          >
            <option value="">All departments</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {/* Round 5 (CB, Oct 2026 — see the component doc comment above): replaces Round 2's
          single-calendar-week prev/next bar with the same whole-pay-period switcher the Timesheet
          review page, My Tasks, and Logged hours already use, plus the "2-week report" link right
          beside it (same `?periodEnd=` convention and markup as Team Availability's own link). No
          `capNextAtCurrent` here — unlike the Timesheet page, a shift can legitimately be scheduled
          into a future period. */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <PayrollPeriodSwitcher offset={offset} onOffsetChange={goToOffset} />
        <Link
          href={`/admin/reports?periodEnd=${weeks.period.end}`}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-accent-ink hover:bg-black/[0.03]"
          title={`2-week report: ${formatWeekRange(weeks.period.start, weeks.period.end)}`}
        >
          <ChartIcon className="h-4 w-4" />
          2-week report
        </Link>
      </div>

      {loadState === "loading" && (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load the schedule. Please try again.
        </div>
      )}

      {loadState === "ready" && filtered.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          No shifts match these filters for this pay period.
        </div>
      )}

      {loadState === "ready" && filtered.length > 0 && (
        <>
          {/* Oct 2026 (CB, from live screenshots of this page filtered to one person): "I don't
              like how it's showing up the same name multiple times... I need it to be
              widgetized." Approved as a mockup before this landed (her new standing requirement
              for this kind of visual change) — a single identity banner replaces the per-card
              name/department line below, and the list collapses into slim divided rows. Only
              shown when a specific employee is filtered to and that filter actually has results
              (isSingleEmployeeView above); multi-employee views are untouched. */}
          {isSingleEmployeeView && singleEmployeeInfo && (
            <div
              className="rounded-2xl overflow-hidden shadow-sm mb-4 p-5"
              style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
            >
              <div className="flex items-center gap-3.5">
                {singleEmployeeInfo.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                  <img
                    src={singleEmployeeInfo.avatarUrl}
                    alt=""
                    className="h-12 w-12 rounded-xl object-cover border border-white/40 shrink-0"
                  />
                ) : (
                  <span className="h-12 w-12 rounded-xl bg-white shrink-0 flex items-center justify-center">
                    <span className="font-serif font-bold text-base text-accent-ink">{initialsOf(singleEmployeeInfo.name) || "?"}</span>
                  </span>
                )}
                <div className="min-w-0">
                  <p className="font-serif text-lg font-bold text-white truncate">{singleEmployeeInfo.name}</p>
                  <p className="text-sm text-white/85 truncate">{singleEmployeeInfo.jobTitle}</p>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <p className="text-sm font-semibold text-white/90">
                    {filtered.length} {filtered.length === 1 ? "shift" : "shifts"} shown
                  </p>
                  {singleEmployeeMissedCount > 0 && (
                    <p className="text-xs text-white/70">{singleEmployeeMissedCount} no clock-in</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            <ScheduleWeekBlock
              weekLabel="Week 1"
              rangeLabel={formatWeekRange(weeks.week1.start, weeks.week1.end)}
              shiftCount={week1Shifts.length}
              open={openWeeks.open1}
              onToggle={() => setOpenWeeks((w) => ({ ...w, open1: !w.open1 }))}
              isSingleEmployeeView={isSingleEmployeeView}
              isGroupedView={isGroupedView}
              shifts={week1Shifts}
              grouped={week1Grouped}
              expandedEmployees={expandedEmployees}
              toggleEmployeeExpanded={toggleEmployeeExpanded}
              renderShiftRow={renderShiftRow}
            />
            <ScheduleWeekBlock
              weekLabel="Week 2"
              rangeLabel={formatWeekRange(weeks.week2.start, weeks.week2.end)}
              shiftCount={week2Shifts.length}
              open={openWeeks.open2}
              onToggle={() => setOpenWeeks((w) => ({ ...w, open2: !w.open2 }))}
              isSingleEmployeeView={isSingleEmployeeView}
              isGroupedView={isGroupedView}
              shifts={week2Shifts}
              grouped={week2Grouped}
              expandedEmployees={expandedEmployees}
              toggleEmployeeExpanded={toggleEmployeeExpanded}
              renderShiftRow={renderShiftRow}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Round 5 — one pay period's Week 1 or Week 2, collapsed to a single header row (its label, date
 *  range, and its own shift count) until tapped open to show that week's shifts — either the
 *  single-employee divided row list or the grouped-by-person cards, exactly as the whole-period
 *  view rendered them before this round, just scoped to one week's `shifts`/`grouped` at a time.
 *  `renderShiftRow`/`expandedEmployees`/`toggleEmployeeExpanded` are passed through from the main
 *  component rather than recreated here, same as WeekAccordionBlock on the Timesheet review page
 *  takes `entries`/`review` as props instead of owning that state itself. Kept local to this file
 *  since nothing else uses this particular accordion chrome. */
function ScheduleWeekBlock({
  weekLabel,
  rangeLabel,
  shiftCount,
  open,
  onToggle,
  isSingleEmployeeView,
  isGroupedView,
  shifts,
  grouped,
  expandedEmployees,
  toggleEmployeeExpanded,
  renderShiftRow,
}: {
  weekLabel: string;
  rangeLabel: string;
  shiftCount: number;
  open: boolean;
  onToggle: () => void;
  isSingleEmployeeView: boolean;
  isGroupedView: boolean;
  shifts: AdminShiftDTO[];
  grouped: GroupedShifts[];
  expandedEmployees: Set<string>;
  toggleEmployeeExpanded: (employeeId: string) => void;
  renderShiftRow: (s: AdminShiftDTO) => JSX.Element;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left hover:bg-black/[0.02]"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-bold">{weekLabel}</span>
          <span className="text-xs text-muted">{rangeLabel}</span>
        </span>
        <span className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-muted">
            {shiftCount} {shiftCount === 1 ? "shift" : "shifts"}
          </span>
          <ChevronDownIcon className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          {shiftCount === 0 ? (
            <p className="text-sm text-muted px-2 py-3">No shifts this week.</p>
          ) : isSingleEmployeeView ? (
            <div className="bg-background border border-border rounded-xl divide-y divide-border overflow-hidden">
              {shifts.map((s) => renderShiftRow(s))}
            </div>
          ) : isGroupedView ? (
            // Round 2 (CB, Oct 2026, on the mockup: "I don't like how it's showing up the same
            // name multiple times... they're supposed to be organized per profile"): one card per
            // person instead of one flat list — a quiet header naming them once (avatar, name,
            // real job title, same correction already made to the single-employee banner), then
            // their shifts as the same compact divided rows the single-employee view uses.
            <div className="space-y-3">
              {grouped.map((group) => {
                const isExpanded = expandedEmployees.has(group.employeeId);
                return (
                  <div key={group.employeeId} className="bg-background border border-border rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleEmployeeExpanded(group.employeeId)}
                      aria-expanded={isExpanded}
                      className="w-full flex items-center gap-3 px-5 py-3.5 bg-black/[0.02] border-b border-border text-left hover:bg-black/[0.04] transition-colors"
                    >
                      {group.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                        <img src={group.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover border border-border shrink-0" />
                      ) : (
                        <span
                          className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                          style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
                        >
                          {initialsOf(group.name) || "?"}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-serif font-bold text-[15px] truncate">{group.name}</p>
                        <p className="text-xs text-muted truncate">{group.jobTitle}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold text-foreground">
                          {group.shifts.length} {group.shifts.length === 1 ? "shift" : "shifts"}
                        </p>
                        {group.missedCount > 0 && (
                          <p className="text-[11px] text-rose-800">{group.missedCount} no clock-in</p>
                        )}
                      </div>
                      <ChevronDownIcon
                        className={`h-3.5 w-3.5 text-muted shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-border">{group.shifts.map((s) => renderShiftRow(s))}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CreateShiftForm({
  employeeOptions,
  onCreate,
  error,
}: {
  employeeOptions: EmployeeOption[];
  onCreate: (input: { employeeId: string; date: string; startTime: string; endTime: string; note: string }) => void;
  error: string | null;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-4 space-y-3">
      <p className="text-sm font-medium">Create a shift manually</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
        >
          <option value="">Choose a team member…</option>
          {employeeOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
        />
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
        />
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
        />
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        rows={2}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
      />
      {error && <p className="text-xs text-accent">{error}</p>}
      <button
        type="button"
        disabled={!employeeId || !date}
        onClick={() => onCreate({ employeeId, date, startTime, endTime, note })}
        className="btn-primary text-sm px-5 py-2.5"
      >
        Create shift
      </button>
    </div>
  );
}
