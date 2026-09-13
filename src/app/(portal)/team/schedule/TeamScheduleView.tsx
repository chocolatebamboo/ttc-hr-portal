"use client";

import { useEffect, useMemo, useState } from "react";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import type { AdminShiftDTO, AssignmentOptionsDTO, DirectReportDTO, ShiftStatus } from "@/types";

type LoadState = "loading" | "ready" | "error";

type EmployeeOption = { id: string; name: string };

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
 */
export default function TeamScheduleView({ viewerIsAdmin }: { viewerIsAdmin: boolean }) {
  const [shifts, setShifts] = useState<AdminShiftDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<{ id: string; name: string }[]>([]);

  const [employeeFilter, setEmployeeFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");

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

  const filtered = useMemo(() => {
    return shifts.filter((s) => {
      if (employeeFilter && s.employeeId !== employeeFilter) return false;
      if (departmentFilter && s.departmentId !== departmentFilter) return false;
      if (statusFilter && s.displayStatus !== statusFilter) return false;
      if (dateFromFilter && s.date < dateFromFilter) return false;
      if (dateToFilter && s.date > dateToFilter) return false;
      return true;
    });
  }, [shifts, employeeFilter, departmentFilter, statusFilter, dateFromFilter, dateToFilter]);

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

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="page-title text-2xl">Team Schedule</h1>
        <button type="button" className="btn-primary shrink-0" onClick={() => setShowCreate((v) => !v)}>
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
        <input
          type="date"
          value={dateFromFilter}
          onChange={(e) => setDateFromFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
        />
        <input
          type="date"
          value={dateToFilter}
          onChange={(e) => setDateToFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
        />
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
          No shifts match these filters.
        </div>
      )}

      {loadState === "ready" && filtered.length > 0 && (
        <div className="space-y-2.5">
          {filtered.map((s) => {
            // Phase 2: Cancel/Reassign stay available on a pending CHANGE_REQUESTED/
            // CANCELLATION_REQUESTED shift too — the spec's own response options to a request
            // include "Change the shift time," "Cancel the shift," and "Reassign the shift," not
            // only a plain approve/decline (see SHIFT_RESOLVABLE_STATUSES in src/lib/shifts.ts).
            const canManage = s.status === "UPCOMING" || s.status === "CHANGE_REQUESTED" || s.status === "CANCELLATION_REQUESTED";
            const hasPendingRequest = s.status === "CHANGE_REQUESTED" || s.status === "CANCELLATION_REQUESTED";
            return (
              <div key={s.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{s.employeeName}</p>
                    <p className="text-sm text-muted">
                      {formatSlotDate(s.date)} · {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
                    </p>
                    {s.departmentName && <p className="text-xs text-muted/70">{s.departmentName}</p>}
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
                      className="btn-outline self-start"
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
                      className="btn-outline self-start"
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
                      className="btn-outline self-start"
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
                      className="btn-outline self-start"
                    >
                      Confirm reassign
                    </button>
                  </div>
                )}
              </div>
            );
          })}
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
        className="btn-primary"
      >
        Create shift
      </button>
    </div>
  );
}
