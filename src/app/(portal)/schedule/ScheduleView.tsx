"use client";

import { useEffect, useState } from "react";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import { formatSlotDate, formatTime12h } from "@/lib/availability-format";
import type { ShiftDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

const UPCOMING_STATUSES = new Set(["UPCOMING", "IN_PROGRESS", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"]);

/**
 * "My Schedule" — phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): the
 * confirmed-Shift counterpart to My Availability. Deliberately separate pages/records: this
 * shows only what a supervisor has actually scheduled (Shift rows), never what's merely been
 * submitted or approved as availability — see Shift's own doc comment in prisma/schema.prisma.
 * A team member can't edit or delete anything here directly (client spec: "the Team Member must
 * not be able to edit or delete it directly"); Request Shift Change / Request Cancellation are
 * phase 2, not yet wired to any button on this page.
 */
export default function ScheduleView() {
  const [shifts, setShifts] = useState<ShiftDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    async function load() {
      setLoadState("loading");
      try {
        const res = await fetch("/api/shifts");
        if (!res.ok) throw new Error();
        const data: { shifts: ShiftDTO[] } = await res.json();
        setShifts(data.shifts);
        setLoadState("ready");
      } catch {
        setLoadState("error");
      }
    }
    load();
  }, []);

  if (loadState === "loading") {
    return (
      <div className="max-w-2xl space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="max-w-2xl rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load your schedule. Please try again or contact HR.
      </div>
    );
  }

  const upcoming = shifts.filter((s) => UPCOMING_STATUSES.has(s.displayStatus));
  const past = shifts.filter((s) => !UPCOMING_STATUSES.has(s.displayStatus));

  return (
    <div className="max-w-2xl">
      <h1 className="page-title text-2xl mb-1">My Schedule</h1>
      <p className="text-sm text-muted mb-4">
        Your confirmed shifts — dates a supervisor has actually scheduled you for, not just what
        you&apos;ve submitted as available.
      </p>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            No upcoming shifts yet. Once a supervisor confirms your availability as a shift, it
            shows up here.
          </div>
        ) : (
          <div className="space-y-2.5">
            {upcoming.map((s) => (
              <ShiftCard key={s.id} shift={s} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
            Past & other ({past.length})
          </h2>
          <div className="space-y-2.5">
            {past.map((s) => (
              <ShiftCard key={s.id} shift={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ShiftCard({ shift }: { shift: ShiftDTO }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{formatSlotDate(shift.date)}</p>
          <p className="text-sm text-muted">
            {formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}
          </p>
        </div>
        <ShiftStatusPill status={shift.displayStatus} />
      </div>
      {shift.note && <p className="text-sm text-muted italic mt-2">&ldquo;{shift.note}&rdquo;</p>}
      {shift.status === "CANCELLED" && shift.cancelReason && (
        <p className="text-sm text-accent mt-2">Cancelled: {shift.cancelReason}</p>
      )}
    </div>
  );
}
