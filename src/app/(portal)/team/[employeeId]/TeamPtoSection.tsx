"use client";

import { useEffect, useState } from "react";
import PtoStatusPill from "@/components/PtoStatusPill";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { PtoRequestDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

export default function TeamPtoSection({ employeeId }: { employeeId: string }) {
  const [requests, setRequests] = useState<PtoRequestDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/pto/requests?employeeId=${employeeId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRequests(data.requests);
      setLoadState(data.requests.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // Fetch-on-mount / on-employee-change: no server-rendered initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function decide(id: string, decision: "APPROVED" | "DENIED", comment?: string) {
    setBusyId(id);
    try {
      await fetch(`/api/pto/requests/${id}/decide`, {
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
        Unable to load time-off requests. Please try again.
      </div>
    );
  }
  if (loadState === "empty") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        No time-off requests from this team member yet.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
      {requests.map((r) => (
        <div key={r.id} className="px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
              </p>
              <p className="text-xs text-muted">
                {r.hours} hours{r.reason ? ` — ${r.reason}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {r.status === "PENDING" ? (
                <>
                  <button
                    onClick={() => decide(r.id, "APPROVED")}
                    disabled={busyId === r.id}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setDenyingId(denyingId === r.id ? null : r.id)}
                    disabled={busyId === r.id}
                    className="btn-neutral text-xs px-3 py-1.5"
                  >
                    Deny
                  </button>
                </>
              ) : (
                <PtoStatusPill status={r.status} />
              )}
            </div>
          </div>

          {denyingId === r.id && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-black/[0.02] rounded-lg p-3">
              <textarea
                value={denyComment}
                onChange={(e) => setDenyComment(e.target.value)}
                placeholder="Optional note for the team member…"
                rows={2}
                className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                onClick={() => decide(r.id, "DENIED", denyComment.trim() || undefined)}
                disabled={busyId === r.id}
                className="btn-primary text-xs px-3 py-1.5 self-start"
              >
                Confirm deny
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
