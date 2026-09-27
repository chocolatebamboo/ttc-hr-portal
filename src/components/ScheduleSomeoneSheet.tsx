"use client";

import { useEffect, useState } from "react";
import { initialsOf } from "@/components/TeamAvailabilityCards";
import { todayDateKey } from "@/lib/time";
import type { AssignmentOptionsDTO } from "@/types";

// A few named brand/accent colors cycling by employee id — purely a visual "who's who" cue on
// the picker rows below, not tied to any real per-person color anywhere else in the app.
const AVATAR_COLORS = ["var(--ttc-pink)", "var(--ttc-blue)", "#7c5cff", "var(--ttc-pink-ink)", "var(--muted)"];
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * "Schedule someone" (CB, Sept 2026, admin Home redesign): "I should be able to have like an
 * option to... schedule somebody else, honestly create their schedule for one of the team
 * members and assign it to them... in a nice clean way to where it's like a button and then it
 * probably opens up." Opens right from AdminHomeHero as a bottom sheet rather than sending the
 * admin to the separate Team Schedule page — same underlying action Team Schedule's own "New
 * shift" form already calls (createShiftManually via POST /api/admin/shifts), just a lighter,
 * single-purpose picker for the common case of scheduling one person. Team Schedule itself is
 * untouched and still the place for anything past that (filtering, cancel/reassign, requests).
 */
export default function ScheduleSomeoneSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [options, setOptions] = useState<AssignmentOptionsDTO | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayDateKey());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/roster/assignable");
        if (!res.ok) throw new Error();
        const data: AssignmentOptionsDTO = await res.json();
        if (!cancelled) setOptions(data);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    if (!employeeId || !date || !startTime || !endTime) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date, startTime, endTime, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create that shift.");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that shift.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-surface rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-border mx-auto mb-4" />
        <p className="text-base font-semibold mb-1">Schedule someone</p>
        <p className="text-xs text-muted mb-4">
          Creates a confirmed shift — no availability submission needed first.
        </p>

        {loadError && (
          <p className="text-sm text-accent mb-3">Unable to load the team list. Please try again.</p>
        )}

        {options && options.employees.length === 0 && (
          <p className="text-sm text-muted mb-3">No active team members to schedule.</p>
        )}

        {options && options.employees.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/70 mb-1.5">
              Team member
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {options.employees.map((e) => (
                <label
                  key={e.id}
                  className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 cursor-pointer ${
                    employeeId === e.id
                      ? "border-[var(--ttc-blue)] bg-[color-mix(in_srgb,var(--ttc-blue)_6%,white)]"
                      : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="scheduleSomeoneEmployee"
                    className="sr-only"
                    checked={employeeId === e.id}
                    onChange={() => setEmployeeId(e.id)}
                  />
                  <span
                    className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
                    style={{ background: colorFor(e.id) }}
                  >
                    {initialsOf(e.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{e.name}</span>
                    {e.departmentName && (
                      <span className="block text-xs text-muted truncate">{e.departmentName}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted/70 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted/70 mb-1">
              Starts
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted/70 mb-1">
              Ends
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted/70 mb-1">
              Note (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            />
          </div>
        </div>

        {error && <p className="text-sm text-accent mt-3">{error}</p>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !employeeId || !date || !startTime || !endTime}
          className="btn-primary w-full mt-4 min-h-[48px]"
        >
          {submitting ? "Creating…" : "Create shift"}
        </button>
      </div>
    </div>
  );
}
