"use client";

import { useEffect, useState } from "react";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { describeSlots } from "@/lib/availability-format";
import type { AvailabilityDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/** Mirrors TeamPtoSection.tsx's shape for a different feature — a supervisor deciding on one
 *  direct report's submitted availability, from the same per-employee review page as their
 *  timesheet and PTO. Every submission this person has ever made shows here, newest first —
 *  not just the latest one — since approving/denying one never overwrites another. */
export default function TeamAvailabilitySection({ employeeId }: { employeeId: string }) {
  const [submissions, setSubmissions] = useState<AvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/availability?employeeId=${employeeId}`);
      if (!res.ok) throw new Error();
      const data: { submissions: AvailabilityDTO[] } = await res.json();
      setSubmissions(data.submissions);
      setLoadState(data.submissions.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function decide(submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) {
    setBusyId(submissionId);
    try {
      await fetch(`/api/availability/${submissionId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });
    } finally {
      setBusyId(null);
      setDenyingId(null);
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
  if (loadState === "empty") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        This team member hasn&apos;t submitted any availability yet.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
      {submissions.map((s) => {
        const lines = describeSlots(s.slots);
        return (
          <div key={s.id} className="px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{lines.join(" · ") || "No dates marked available."}</p>
              <div className="flex items-center gap-2 shrink-0">
                {s.status === "PENDING" ? (
                  <>
                    <button onClick={() => decide(s.id, "APPROVED")} disabled={busyId === s.id} className="btn-primary text-xs px-3 py-1.5">
                      Approve
                    </button>
                    <button
                      onClick={() => setDenyingId(denyingId === s.id ? null : s.id)}
                      disabled={busyId === s.id}
                      className="btn-neutral text-xs px-3 py-1.5"
                    >
                      Deny
                    </button>
                  </>
                ) : (
                  <AvailabilityStatusPill status={s.status} />
                )}
              </div>
            </div>

            {s.note && <p className="text-xs text-muted mt-1">&ldquo;{s.note}&rdquo;</p>}

            {s.status === "DENIED" && s.reviewComment && <p className="text-xs text-accent mt-1">Denied: {s.reviewComment}</p>}

            {denyingId === s.id && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-black/[0.02] rounded-lg p-3">
                <textarea
                  value={denyComment}
                  onChange={(e) => setDenyComment(e.target.value)}
                  placeholder="Optional note for the team member…"
                  rows={2}
                  className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  onClick={() => decide(s.id, "DENIED", denyComment.trim() || undefined)}
                  disabled={busyId === s.id}
                  className="btn-primary text-xs px-3 py-1.5 self-start"
                >
                  Confirm deny
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
