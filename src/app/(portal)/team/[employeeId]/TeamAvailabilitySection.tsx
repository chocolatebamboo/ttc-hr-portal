"use client";

import { useEffect, useState } from "react";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { describeSlots } from "@/lib/availability-format";
import type { AvailabilityDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** Mirrors TeamPtoSection.tsx's shape for a different feature — a supervisor deciding on one
 *  direct report's submitted weekly availability pattern, from the same per-employee review
 *  page as their timesheet and PTO. */
export default function TeamAvailabilitySection({ employeeId }: { employeeId: string }) {
  const [availability, setAvailability] = useState<AvailabilityDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [denying, setDenying] = useState(false);
  const [denyComment, setDenyComment] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/availability?employeeId=${employeeId}`);
      if (!res.ok) throw new Error();
      const data: AvailabilityDTO = await res.json();
      setAvailability(data);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function decide(decision: "APPROVED" | "DENIED", comment?: string) {
    setBusy(true);
    try {
      await fetch(`/api/availability/${employeeId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });
    } finally {
      setBusy(false);
      setDenying(false);
      setDenyComment("");
      load();
    }
  }

  if (loadState === "loading") {
    return <div className="h-24 rounded-xl border border-border bg-surface animate-pulse" />;
  }
  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-accent">
        Unable to load this team member&apos;s availability. Please try again.
      </div>
    );
  }
  if (!availability?.exists) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        This team member hasn&apos;t submitted their weekly availability yet.
      </div>
    );
  }

  const lines = describeSlots(availability.slots);

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-medium">Weekly availability</p>
        <AvailabilityStatusPill status={availability.status} />
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted">No days marked available.</p>
      ) : (
        <ul className="text-sm text-muted space-y-0.5 mb-2">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {availability.note && <p className="text-sm text-muted mt-1">&ldquo;{availability.note}&rdquo;</p>}

      {availability.status === "DENIED" && availability.reviewComment && (
        <p className="text-xs text-accent mt-2">Denied: {availability.reviewComment}</p>
      )}

      {availability.status === "PENDING" && (
        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => decide("APPROVED")} disabled={busy} className="btn-primary text-xs px-3 py-1.5">
            Approve
          </button>
          <button onClick={() => setDenying((d) => !d)} disabled={busy} className="btn-neutral text-xs px-3 py-1.5">
            Deny
          </button>
        </div>
      )}

      {denying && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-black/[0.02] rounded-lg p-3">
          <textarea
            value={denyComment}
            onChange={(e) => setDenyComment(e.target.value)}
            placeholder="Optional note for the team member…"
            rows={2}
            className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={() => decide("DENIED", denyComment.trim() || undefined)}
            disabled={busy}
            className="btn-primary text-xs px-3 py-1.5 self-start"
          >
            Confirm deny
          </button>
        </div>
      )}
    </div>
  );
}
