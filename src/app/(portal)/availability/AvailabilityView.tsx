"use client";

import { useEffect, useState } from "react";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { DAY_LABELS } from "@/lib/availability-format";
import type { AvailabilityDTO, AvailabilitySlot } from "@/types";

type LoadState = "loading" | "ready" | "error";

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

/** One row per day, keyed by dayOfWeek — undefined means "not available that day," present
 *  (even with blank times mid-edit) means the toggle is on. Kept as a fixed 7-slot array
 *  rather than the sparse AvailabilitySlot[] the API uses, since a form needs a stable row
 *  for every day whether or not it's currently toggled on. */
type DraftRow = { on: boolean; startTime: string; endTime: string };

function blankDraft(): DraftRow[] {
  return DAY_LABELS.map(() => ({ on: false, startTime: DEFAULT_START, endTime: DEFAULT_END }));
}

function slotsToDraft(slots: AvailabilitySlot[]): DraftRow[] {
  const draft = blankDraft();
  for (const s of slots) {
    draft[s.dayOfWeek] = { on: true, startTime: s.startTime, endTime: s.endTime };
  }
  return draft;
}

function draftToSlots(draft: DraftRow[]): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  draft.forEach((row, dayOfWeek) => {
    if (row.on) {
      slots.push({ dayOfWeek: dayOfWeek as AvailabilitySlot["dayOfWeek"], startTime: row.startTime, endTime: row.endTime });
    }
  });
  return slots;
}

/**
 * "Availability" (CB, Sept 2026): a team member's own standing WEEKLY pattern — which days
 * and roughly what hours they're generally free — submitted once and edited whenever it
 * changes, not resubmitted every week. A supervisor or HR/Super Admin approves it (see
 * TeamAvailabilitySection / AvailabilityAdminView); once approved it's purely informational
 * for whoever's scheduling — nothing in the app enforces it against anything yet, since there
 * is no shift-scheduling feature to enforce it against.
 *
 * Deliberately its own page rather than folded into My Time: that page is already timesheet +
 * PTO, both about actual worked/requested dates, where this is a recurring pattern with no
 * date at all.
 */
export default function AvailabilityView() {
  const [current, setCurrent] = useState<AvailabilityDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [draft, setDraft] = useState<DraftRow[]>(blankDraft());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [justSubmitted, setJustSubmitted] = useState(false);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/availability");
      if (!res.ok) throw new Error();
      const data: AvailabilityDTO = await res.json();
      setCurrent(data);
      setDraft(slotsToDraft(data.slots));
      setNote(data.note ?? "");
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function toggleDay(dayOfWeek: number) {
    setJustSubmitted(false);
    setDraft((d) => d.map((row, i) => (i === dayOfWeek ? { ...row, on: !row.on } : row)));
  }

  function updateTime(dayOfWeek: number, field: "startTime" | "endTime", value: string) {
    setJustSubmitted(false);
    setDraft((d) => d.map((row, i) => (i === dayOfWeek ? { ...row, [field]: value } : row)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: draftToSlots(draft), note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to submit your availability. Please try again.");
        return;
      }
      setCurrent(data);
      setJustSubmitted(true);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="page-title text-2xl mb-1">Availability</h1>
      <p className="text-sm text-muted mb-4">
        Let HR and your supervisor know which days and times you&apos;re generally free, so they
        don&apos;t have to ask you individually. This is a standing weekly pattern, not tied to
        any specific date — update it any time your schedule changes.
      </p>

      {loadState === "loading" && <div className="h-64 rounded-xl border border-border bg-surface animate-pulse" />}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your availability. Please try again or contact HR.
        </div>
      )}

      {loadState === "ready" && current && (
        <>
          {current.exists && (
            <div className="rounded-xl border border-border bg-surface p-4 mb-4">
              <div className="flex items-center justify-between gap-3 mb-1">
                <p className="text-sm font-medium">Current status</p>
                <AvailabilityStatusPill status={current.status} />
              </div>
              {current.status === "DENIED" && current.reviewComment && (
                <p className="text-xs text-accent mt-1">Denied: {current.reviewComment}</p>
              )}
              {current.status === "PENDING" && (
                <p className="text-xs text-muted mt-1">Waiting on your supervisor or HR to approve.</p>
              )}
            </div>
          )}

          {justSubmitted && (
            <div className="rounded-xl bg-emerald-50 text-emerald-800 text-sm px-4 py-3 mb-4">
              Submitted — your supervisor or HR will review it.
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-5 space-y-1">
            {DAY_LABELS.map((label, dayOfWeek) => {
              const row = draft[dayOfWeek];
              return (
                <div
                  key={label}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-2.5 border-b border-border last:border-b-0"
                >
                  <label className="flex items-center gap-2 sm:w-36 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.on}
                      onChange={() => toggleDay(dayOfWeek)}
                      className="h-4 w-4 rounded border-border accent-accent-ink"
                    />
                    <span className="text-sm font-medium">{label}</span>
                  </label>

                  {row.on ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={row.startTime}
                        onChange={(e) => updateTime(dayOfWeek, "startTime", e.target.value)}
                        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                      />
                      <span className="text-sm text-muted">to</span>
                      <input
                        type="time"
                        value={row.endTime}
                        onChange={(e) => updateTime(dayOfWeek, "endTime", e.target.value)}
                        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-muted/60">Not available</span>
                  )}
                </div>
              );
            })}

            <div className="pt-3">
              <label className="block text-sm font-medium mb-1.5">Note (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Anything your supervisor or HR should know…"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent resize-none"
              />
            </div>

            {error && <p className="text-sm text-accent">{error}</p>}

            <button type="submit" disabled={submitting} className="btn-primary px-5 py-2.5 text-sm w-full sm:w-auto mt-2">
              {submitting ? "Submitting…" : current.exists ? "Update availability" : "Submit for approval"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
