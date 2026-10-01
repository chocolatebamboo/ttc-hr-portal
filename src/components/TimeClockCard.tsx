"use client";

import { useEffect, useState } from "react";
import { deriveClockState, formatClockTime, formatElapsedClock, formatMinutes } from "@/lib/time";
import type { TimeClockState, TimeEntryDTO } from "@/types";
import { WarningIcon } from "@/components/icons";

type LoadState = "loading" | "ready" | "error";
type ActionState = "idle" | "submitting";

// CB: "after three hours... should get a notification to remind them to clock out" — the
// in-app half of that (the email half is src/lib/clockout-reminders.ts, run on a schedule
// server-side, since this banner only helps while the tab happens to be open).
const REMINDER_THRESHOLD_MS = 3 * 60 * 60 * 1000;

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

// CB, Sept 2026: wants the actual current date/time visible on the Clock In card itself —
// "so that we know... it's real time, what time it is, and the date" — rather than someone
// having to trust that "Today" really means right now. Ticks every second (not just the
// once-a-minute reminder tick below, which is deliberately coarse) since a clock that's
// visibly moving is the point.
function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Phase 3 (client spec, Sept 2026): "clock-in gated to scheduled shifts with a 15-minute
 *  window and exception-reason flagging" — the caller's own before-the-click preview of what
 *  clocking in right now would do (GET /api/time/clock-in-status). Never blocks the button;
 *  when it says a reason is required, the reason gets typed here and sent along with the
 *  clock-in itself, which re-checks everything fresh at that moment. */
type ClockInStatus = { requiresReason: boolean; reasonPromptKind: "no_shift" | "outside_window" | null };

const REASON_PROMPT: Record<"no_shift" | "outside_window", string> = {
  no_shift: "You don't have a shift scheduled today — why are you clocking in?",
  outside_window: "This is outside your scheduled shift's start time — why are you clocking in early or late?",
};

/**
 * CB, Sept 2026 (admin Home redesign): "Shawn the founder will never clock in... Randall
 * [won't either]... everyone else will clock in but Daijour we also need the option to clock
 * in as well." `clocksIn` (Employee.clocksIn, always passed by the caller — see the dashboard
 * page and AdminHomeHero) is a per-person exception, independent of role: when false, every
 * variant below shows only the live time/date — no status line, no button, no hours stat, no
 * sessions list, nothing to interact with. True is the default for everyone; this only ever
 * changes for someone HR has explicitly turned it off for in the Employees admin edit form.
 *
 * `variant="compact"` (new, admin Home redesign) is the same status/button/sessions content as
 * "default", minus the big time face (the admin hero above it already shows the time) and
 * wrapped a little tighter — this is what "Need to clock in yourself?" expands into on the
 * admin dashboard. `onClose` is compact-only: a small × the admin dashboard uses to collapse
 * it back, rendered here (not by the caller) since the status text it sits next to comes from
 * this component's own fetched state.
 */
export default function TimeClockCard({
  variant = "default",
  clocksIn = true,
  onClose,
}: {
  variant?: "default" | "hero" | "compact";
  clocksIn?: boolean;
  onClose?: () => void;
}) {
  const [entry, setEntry] = useState<TimeEntryDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [clockInStatus, setClockInStatus] = useState<ClockInStatus | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");
  const now = useLiveClock();
  const liveDate = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  // CB, Sept 2026: wants this "bigger... like one of the widgets Apple has... reading
  // cleanly" — seconds dropped from the display for that (a big number visibly ticking every
  // second reads as noisy/busy, the opposite of a clean widget face), even though the
  // underlying clock (useLiveClock above) still updates every second same as before.
  const liveTime = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  async function refresh() {
    try {
      const res = await fetch("/api/time/today");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntry(data.entry);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      return;
    }
    // Best-effort: a failure here just means the reason prompt won't show proactively — the
    // real check still happens inside the clock-in POST itself, so this never blocks the card.
    try {
      const statusRes = await fetch("/api/time/clock-in-status");
      if (statusRes.ok) {
        setClockInStatus(await statusRes.json());
      }
    } catch {
      // ignore — see comment above
    }
  }

  useEffect(() => {
    // Intentional fetch-on-mount: the time clock has no server-rendered initial state (its
    // status can change from another tab/device between page loads), so it has to ask the
    // API as soon as it mounts. `refresh` is also reused by the "try again" and error-retry
    // paths below, not just here. Skipped entirely when clocksIn is false — someone who never
    // clocks in has nothing here to fetch, and shouldn't sit on "loading" waiting for it.
    if (!clocksIn) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [clocksIn]);

  // Forces a re-render once a minute so the 3-hour reminder banner below can appear on its own
  // — without this, "clocked in for 3+ hours" would only get re-checked the next time `entry`
  // happens to change (a clock-in/out action or a manual refresh), not just from time passing.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function performAction(endpoint: string, body?: { reason?: string }) {
    setActionState("submitting");
    setErrorMessage("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error ?? "Unable to update your time clock. Please try again or contact HR.");
        await refresh(); // re-sync in case another tab/device already changed the state
        return;
      }
      setEntry(data.entry);
      setExceptionReason(""); // clear on success so the next clock-in starts fresh
      await refresh(); // re-fetch clock-in-status too — the shift/window match can shift by the minute
    } catch {
      setErrorMessage("Unable to reach the server. Check your connection and try again.");
    } finally {
      setActionState("idle");
    }
  }

  // clocksIn === false: nothing to fetch, nothing to click — just the live time/date, same
  // face every other variant shows, with no status line, button, hours stat, or sessions list.
  // "compact" only ever renders while expanded from AdminHomeHero's own clocksIn-gated toggle,
  // so it shouldn't be reachable here — null rather than a half-built card if it ever is.
  if (!clocksIn) {
    if (variant === "compact") return null;
    if (variant === "hero") {
      return (
        <div className="rounded-3xl p-6 text-white shadow-lg" style={{ background: "var(--ttc-pink)" }}>
          <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{liveTime}</p>
          <p className="text-sm font-medium text-white/75 mt-1.5">{liveDate}</p>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <p className="text-3xl font-bold tabular-nums leading-none tracking-tight mb-1.5">{liveTime}</p>
        <p className="text-xs uppercase tracking-wide text-muted/60">{liveDate}</p>
      </div>
    );
  }

  if (loadState === "loading") {
    return variant === "hero" ? (
      <div className="rounded-3xl p-6 h-[220px] animate-pulse bg-[color-mix(in_srgb,var(--ttc-pink)_25%,white)]" />
    ) : (
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

  // Phase 3: only a clock-in (never clock-out, per CB's confirmed policy) can require a reason,
  // and only when the before-the-click preview says so.
  const isClockInAction = action.endpoint === "/api/time/clock-in";
  const needsReason = isClockInAction && clockInStatus?.requiresReason === true;
  const reasonPrompt = clockInStatus?.reasonPromptKind ? REASON_PROMPT[clockInStatus.reasonPromptKind] : null;
  const reasonTrimmed = exceptionReason.trim().length > 0;

  function handleClockAction() {
    if (needsReason) {
      performAction(action.endpoint, { reason: exceptionReason });
    } else {
      performAction(action.endpoint);
    }
  }

  // CB, Oct 2026: "were supposed to see the clock running when the team clocks in, that is
  // very important" — raised after a report that a clock-out "didn't record at all" (it had;
  // live-database inspection confirmed the session closed correctly). The real gap was that
  // "Hours today" only ever updates once a session CLOSES (see computeTotalMinutes's own doc
  // comment), so clocking in produced no visible, moving confirmation that anything was being
  // tracked. openElapsedMs is driven by `now` (useLiveClock above, ticking every second) rather
  // than a fresh Date() read at render time, so it's tied to the same 1-second heartbeat that
  // already drives the time-of-day face — the number below visibly moves for the same reason
  // the clock face does. liveTotalMinutes folds that still-open session into "Hours today" too,
  // so that figure stops looking frozen the moment someone clocks in, not just at clock-out.
  const openSession = entry?.sessions.find((s) => s.clockOut === null);
  const openElapsedMs = openSession ? Math.max(0, now.getTime() - new Date(openSession.clockIn).getTime()) : 0;
  const openMinutes = Math.floor(openElapsedMs / 60000);
  const liveTotalMinutes = state === "CLOCKED_IN" ? (entry?.totalMinutes ?? 0) + openMinutes : (entry?.totalMinutes ?? null);
  const showReminder = state === "CLOCKED_IN" && openSession != null && openElapsedMs >= REMINDER_THRESHOLD_MS;

  // Every session logged today, most recent last — so clocking in and out several times (a
  // break, an errand, whatever) shows up as a plain running list rather than only ever
  // showing one in/out pair. Shared between both variants; only the text color differs.
  const sessionsList = entry && entry.sessions.length > 0 && (
    <div className={`mt-4 space-y-1.5 ${variant === "hero" ? "text-white/80" : "text-muted"}`}>
      {entry.sessions.map((s) => (
        <div key={s.id} className="text-xs">
          <div className="flex items-center justify-between">
            <span>
              {formatClockTime(s.clockIn)} – {s.clockOut ? formatClockTime(s.clockOut) : "now"}
            </span>
            {!s.clockOut && (
              <span className={`font-medium ${variant === "hero" ? "text-white" : "text-accent-ink"}`}>
                In progress
              </span>
            )}
          </div>
          {/* Phase 3: flag on a session's own clock-in, visible to the employee whose session
              this is — the same flag a supervisor sees on the timesheet review side. */}
          {s.isException && (
            <p className={`mt-0.5 flex items-start gap-1 ${variant === "hero" ? "text-white/70" : "text-amber-700"}`}>
              <WarningIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Flagged{s.exceptionReason ? `: ${s.exceptionReason}` : ""}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );

  if (variant === "compact") {
    // Admin Home redesign (CB, Sept 2026): what "Need to clock in yourself?" expands into,
    // right under AdminHomeHero's own time/date — same status/button/sessions content as
    // "default" below, just without repeating the big time face (already shown above this)
    // and with `onClose` rendered as a small × next to the status line so collapsing it back
    // doesn't need its own separate control bar.
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-base font-semibold flex items-center gap-1.5">
              {STATUS_LABEL[state]}
              {state === "CLOCKED_IN" && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              )}
            </p>
            {state === "CLOCKED_IN" && (
              <p className="text-xs text-muted mt-0.5 tabular-nums">
                Clocked in for {formatElapsedClock(openElapsedMs)} · {formatMinutes(liveTotalMinutes)} today
              </p>
            )}
            {state === "CLOCKED_OUT" && (
              <p className="text-xs text-muted mt-0.5">Hours today: {formatMinutes(liveTotalMinutes)}</p>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide clock in"
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted hover:bg-black/[0.05] text-base leading-none shrink-0"
            >
              ×
            </button>
          )}
        </div>

        {showReminder && (
          <div role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            You&apos;ve been clocked in for {formatMinutes(openMinutes)} — don&apos;t forget to clock out.
          </div>
        )}

        {needsReason && (
          <div className="mb-3">
            <p className="flex items-start gap-1.5 text-xs text-amber-800 mb-1.5">
              <WarningIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{reasonPrompt}</span>
            </p>
            <textarea
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
              placeholder="Reason for clocking in…"
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent-ink"
            />
          </div>
        )}

        <button
          onClick={handleClockAction}
          disabled={actionState === "submitting" || (needsReason && !reasonTrimmed)}
          className="btn-primary w-full min-h-[46px] text-sm"
        >
          {actionState === "submitting" ? "Updating…" : action.label}
        </button>

        {errorMessage && (
          <p role="alert" className="mt-2.5 text-sm text-accent">
            {errorMessage}
          </p>
        )}

        {sessionsList}
      </div>
    );
  }

  if (variant === "hero") {
    // Bold color-block treatment for the mobile Dashboard (CB's Sept 2026 aesthetic pass —
    // the reference screenshots she shared). Solid brand pink, NOT a gradient — CB's first-
    // round feedback was "I don't necessarily like the gradient on that first card," and this
    // also matches the solid pink stat tile right below it rather than introducing a fourth,
    // blended treatment. No blur/glass either: see BottomNav's floating-pill doc comment for
    // why glass specifically stayed out of this pass (CB rejected a frosted-glass + glow
    // treatment on this same card even earlier).
    return (
      <div
        className="rounded-3xl p-6 text-white shadow-lg"
        style={{ background: "var(--ttc-pink)" }}
      >
        {/* CB, Sept 2026: wanted the date/time bigger, "like one of the widgets that Apple
            has... reading cleanly" — a big bold time face with the date as a small caption
            underneath, the way an iOS clock widget reads, rather than a thin single line of
            small text. Sized just above "Hours today" below so the two don't compete for
            which one is the card's headline number. */}
        <div className="mb-4">
          <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{liveTime}</p>
          <p className="text-sm font-medium text-white/75 mt-1.5">{liveDate}</p>
        </div>
        <div className="flex items-center gap-2 mb-4">
          <p className="text-xl font-bold">{STATUS_LABEL[state]}</p>
          {state === "CLOCKED_IN" && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/90">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
              Live
            </span>
          )}
        </div>

        {state !== "BEFORE_WORK" && (
          <div className="mb-5">
            {state === "CLOCKED_IN" ? (
              <>
                <p className="text-xs text-white/70 mb-0.5">Clocked in for</p>
                <p className="text-4xl font-bold tabular-nums leading-none">{formatElapsedClock(openElapsedMs)}</p>
                <p className="text-xs text-white/70 mt-1.5">Hours today: {formatMinutes(liveTotalMinutes)}</p>
              </>
            ) : (
              <>
                <p className="text-xs text-white/70 mb-0.5">Hours today</p>
                <p className="text-4xl font-bold tabular-nums leading-none">{formatMinutes(liveTotalMinutes)}</p>
              </>
            )}
          </div>
        )}

        {showReminder && (
          <div role="status" className="mb-4 rounded-xl bg-white/15 px-4 py-3 text-sm">
            You&apos;ve been clocked in for {formatMinutes(openMinutes)} — don&apos;t forget to clock out when
            you&apos;re done.
          </div>
        )}

        {/* Phase 3: shown proactively (before the click) whenever clocking in right now would
            be an exception — never blocks the button itself, just requires a reason first. */}
        {needsReason && (
          <div className="mb-4">
            <p className="flex items-start gap-1.5 text-sm text-white/90 mb-2">
              <WarningIcon className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{reasonPrompt}</span>
            </p>
            <textarea
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
              placeholder="Reason for clocking in…"
              rows={2}
              className="w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/60 focus:outline-none focus:border-white/60"
            />
          </div>
        )}

        <button
          onClick={handleClockAction}
          disabled={actionState === "submitting" || (needsReason && !reasonTrimmed)}
          className="inline-flex items-center justify-center w-full min-h-[56px] rounded-full bg-white text-accent-ink font-semibold text-base transition-opacity disabled:opacity-70"
        >
          {actionState === "submitting" ? "Updating…" : action.label}
        </button>

        {errorMessage && (
          <p role="alert" className="mt-3 text-sm text-white">
            {errorMessage}
          </p>
        )}

        {sessionsList}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          {/* Same bigger, cleaner widget-style time face as the mobile hero card above, scaled
              down for this denser desktop card. */}
          <p className="text-3xl font-bold tabular-nums leading-none tracking-tight mb-1.5">{liveTime}</p>
          <p className="text-xs uppercase tracking-wide text-muted/60 mb-2">{liveDate}</p>
          <p className="text-lg font-semibold flex items-center gap-2">
            {STATUS_LABEL[state]}
            {state === "CLOCKED_IN" && (
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                Live
              </span>
            )}
          </p>
        </div>
        {state !== "BEFORE_WORK" && (
          <div className="text-right">
            {state === "CLOCKED_IN" ? (
              <>
                <p className="text-xs uppercase tracking-wide text-muted/70 mb-1">Clocked in for</p>
                <p className="text-lg font-semibold tabular-nums">{formatElapsedClock(openElapsedMs)}</p>
                <p className="text-xs text-muted mt-1">Hours today: {formatMinutes(liveTotalMinutes)}</p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wide text-muted/70 mb-1">Hours today</p>
                <p className="text-lg font-semibold tabular-nums">{formatMinutes(liveTotalMinutes)}</p>
              </>
            )}
          </div>
        )}
      </div>

      {showReminder && (
        <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You&apos;ve been clocked in for {formatMinutes(openMinutes)} — don&apos;t forget to clock out when
          you&apos;re done.
        </div>
      )}

      {/* Phase 3: shown proactively (before the click) whenever clocking in right now would be
          an exception — never blocks the button itself, just requires a reason first. */}
      {needsReason && (
        <div className="mb-4">
          <p className="flex items-start gap-1.5 text-sm text-amber-800 mb-2">
            <WarningIcon className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{reasonPrompt}</span>
          </p>
          <textarea
            value={exceptionReason}
            onChange={(e) => setExceptionReason(e.target.value)}
            placeholder="Reason for clocking in…"
            rows={2}
            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:border-accent-ink"
          />
        </div>
      )}

      <button
        onClick={handleClockAction}
        disabled={actionState === "submitting" || (needsReason && !reasonTrimmed)}
        className="btn-primary w-full min-h-[56px] text-base"
      >
        {actionState === "submitting" ? "Updating…" : action.label}
      </button>

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {errorMessage}
        </p>
      )}

      {sessionsList}
    </div>
  );
}
