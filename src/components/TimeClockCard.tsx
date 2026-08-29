"use client";

import { useEffect, useState } from "react";
import { deriveClockState, formatClockTime, formatMinutes } from "@/lib/time";
import type { TimeClockState, TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";
type ActionState = "idle" | "submitting";

const ACTION_BY_STATE: Record<TimeClockState, { label: string; endpoint: string } | null> = {
  BEFORE_WORK: { label: "Clock In", endpoint: "/api/time/clock-in" },
  CLOCKED_IN: { label: "Start Lunch", endpoint: "/api/time/lunch-start" },
  ON_LUNCH: { label: "End Lunch", endpoint: "/api/time/lunch-end" },
  AFTER_LUNCH: { label: "Clock Out", endpoint: "/api/time/clock-out" },
  CLOCKED_OUT: null,
};

const STATUS_LABEL: Record<TimeClockState, string> = {
  BEFORE_WORK: "Not clocked in",
  CLOCKED_IN: "Clocked in",
  ON_LUNCH: "On lunch",
  AFTER_LUNCH: "Back from lunch",
  CLOCKED_OUT: "Workday complete",
};

export default function TimeClockCard() {
  const [entry, setEntry] = useState<TimeEntryDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function refresh() {
    try {
      const res = await fetch("/api/time/today");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntry(data.entry);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // Intentional fetch-on-mount: the time clock has no server-rendered initial state (its
    // status can change from another tab/device between page loads), so it has to ask the
    // API as soon as it mounts. `refresh` is also reused by the "try again" and error-retry
    // paths below, not just here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  async function performAction(endpoint: string) {
    setActionState("submitting");
    setErrorMessage("");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error ?? "Unable to update your time clock. Please try again or contact HR.");
        await refresh(); // re-sync in case another tab/device already changed the state
        return;
      }
      setEntry(data.entry);
    } catch {
      setErrorMessage("Unable to reach the server. Check your connection and try again.");
    } finally {
      setActionState("idle");
    }
  }

  if (loadState === "loading") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 animate-pulse">
        <div className="h-4 w-28 bg-black/10 rounded mb-4" />
        <div className="h-12 w-full bg-black/10 rounded-xl" />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <p className="text-sm text-accent mb-3">
          Unable to load your time clock. Please try again or contact HR.
        </p>
        <button onClick={refresh} className="text-sm text-accent-ink font-medium hover:underline">
          Try again
        </button>
      </div>
    );
  }

  const state = deriveClockState(entry);
  const primaryAction = ACTION_BY_STATE[state];
  // Matches the brief exactly: right after clocking in, both "Start Lunch" (primary) and
  // "Clock Out" (secondary) are valid — an employee working straight through skips lunch.
  const showSecondaryClockOut = state === "CLOCKED_IN";

  return (
    <div className="frost-card rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted/70 mb-1">Today</p>
          <p className="text-lg font-semibold">{STATUS_LABEL[state]}</p>
        </div>
        {state !== "BEFORE_WORK" && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted/70 mb-1">Hours today</p>
            <p className="text-lg font-semibold tabular-nums">{formatMinutes(entry?.totalMinutes ?? null)}</p>
          </div>
        )}
      </div>

      {state === "CLOCKED_OUT" ? (
        <div className="rounded-xl bg-black/[0.03] p-4 text-sm">
          <p className="font-medium mb-2">Workday summary</p>
          <dl className="grid grid-cols-2 gap-y-1 text-muted">
            <dt>Clocked in</dt>
            <dd className="text-foreground">{formatClockTime(entry?.clockIn ?? null)}</dd>
            <dt>Lunch</dt>
            <dd className="text-foreground">
              {formatClockTime(entry?.lunchStart ?? null)} – {formatClockTime(entry?.lunchEnd ?? null)}
            </dd>
            <dt>Clocked out</dt>
            <dd className="text-foreground">{formatClockTime(entry?.clockOut ?? null)}</dd>
            <dt>Total</dt>
            <dd className="text-foreground font-medium">{formatMinutes(entry?.totalMinutes ?? null)}</dd>
          </dl>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          {primaryAction && (
            <button
              onClick={() => performAction(primaryAction.endpoint)}
              disabled={actionState === "submitting"}
              className="btn-primary flex-1 min-h-[56px] text-base"
            >
              {actionState === "submitting" ? "Updating…" : primaryAction.label}
            </button>
          )}
          {showSecondaryClockOut && (
            <button
              onClick={() => performAction("/api/time/clock-out")}
              disabled={actionState === "submitting"}
              className="btn-neutral min-h-[56px] px-5 text-sm"
            >
              Clock Out
            </button>
          )}
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {errorMessage}
        </p>
      )}

      {entry?.clockIn && state !== "CLOCKED_OUT" && (
        <div className="mt-4 flex gap-4 text-xs text-muted">
          <span>In: {formatClockTime(entry.clockIn)}</span>
          {entry.lunchStart && <span>Lunch start: {formatClockTime(entry.lunchStart)}</span>}
          {entry.lunchEnd && <span>Lunch end: {formatClockTime(entry.lunchEnd)}</span>}
        </div>
      )}
    </div>
  );
}
