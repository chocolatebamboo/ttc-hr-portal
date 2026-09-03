"use client";

import { useEffect, useState } from "react";
import { deriveClockState, formatClockTime, formatMinutes } from "@/lib/time";
import type { TimeClockState, TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";
type ActionState = "idle" | "submitting";

// Just two actions now — clock in or clock out — since there's no lunch step and no cap on
// how many times a day either can happen. CLOCKED_OUT isn't a terminal "workday complete"
// state anymore; it just means "no open session right now," so Clock In is offered from there
// exactly like BEFORE_WORK.
const ACTION_BY_STATE: Record<TimeClockState, { label: string; endpoint: string }> = {
  BEFORE_WORK: { label: "Clock In", endpoint: "/api/time/clock-in" },
  CLOCKED_IN: { label: "Clock Out", endpoint: "/api/time/clock-out" },
  CLOCKED_OUT: { label: "Clock In", endpoint: "/api/time/clock-in" },
};

const STATUS_LABEL: Record<TimeClockState, string> = {
  BEFORE_WORK: "Not clocked in",
  CLOCKED_IN: "Clocked in",
  CLOCKED_OUT: "Clocked out",
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
  const action = ACTION_BY_STATE[state];

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
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

      <button
        onClick={() => performAction(action.endpoint)}
        disabled={actionState === "submitting"}
        className="btn-primary w-full min-h-[56px] text-base"
      >
        {actionState === "submitting" ? "Updating…" : action.label}
      </button>

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {errorMessage}
        </p>
      )}

      {/* Every session logged today, most recent last — so clocking in and out several times
          (a break, an errand, whatever) shows up as a plain running list rather than only ever
          showing one in/out pair. */}
      {entry && entry.sessions.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {entry.sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-xs text-muted">
              <span>
                {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "now"}
              </span>
              {!s.clockOut && <span className="text-accent-ink font-medium">In progress</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
