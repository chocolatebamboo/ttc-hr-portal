"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PtoStatusPill from "@/components/PtoStatusPill";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { AdminPtoRequestDTO, AdminPtoSummaryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * HR-wide PTO dashboard — a Pending queue for HR to act on directly (deciding here reuses
 * /api/pto/requests/[id]/decide, the same endpoint a supervisor uses on TeamPtoSection — an
 * HR/Super Admin passes assertCanReviewTimesheet's admin bypass for any employee), plus an
 * Upcoming section so HR can see who's already approved to be out before it becomes a
 * same-day surprise.
 */
export default function PtoAdminView() {
  const [summary, setSummary] = useState<AdminPtoSummaryDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/pto");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSummary(data);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

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

  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">PTO Management</h1>
      <p className="text-sm text-muted mb-4">
        Every team member&apos;s time-off requests, org-wide — not just one supervisor&apos;s team.
      </p>

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load PTO requests. Please try again or contact support.
        </div>
      )}

      {loadState === "ready" && summary && (
        <>
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">
              Pending ({summary.pending.length})
            </h2>
            {summary.pending.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
                Nothing pending right now.
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
                {summary.pending.map((r) => (
                  <PendingRow
                    key={r.id}
                    request={r}
                    busy={busyId === r.id}
                    denying={denyingId === r.id}
                    denyComment={denyComment}
                    onDenyToggle={() => setDenyingId(denyingId === r.id ? null : r.id)}
                    onDenyCommentChange={setDenyComment}
                    onDecide={decide}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">
              Upcoming approved leave ({summary.upcoming.length})
            </h2>
            {summary.upcoming.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
                No approved time off scheduled from today onward.
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
                {summary.upcoming.map((r) => (
                  <div key={r.id} className="px-4 py-3.5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        <Link href={`/team/${r.employeeId}`} className="hover:underline">
                          {r.employeeName}
                        </Link>{" "}
                        · {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
                      </p>
                      <p className="text-xs text-muted">{r.hours} hours{r.reason ? ` — ${r.reason}` : ""}</p>
                    </div>
                    <PtoStatusPill status={r.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PendingRow({
  request: r,
  busy,
  denying,
  denyComment,
  onDenyToggle,
  onDenyCommentChange,
  onDecide,
}: {
  request: AdminPtoRequestDTO;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (id: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            <Link href={`/team/${r.employeeId}`} className="hover:underline">
              {r.employeeName}
            </Link>{" "}
            · {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
          </p>
          <p className="text-xs text-muted">
            {r.hours} hours{r.reason ? ` — ${r.reason}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onDecide(r.id, "APPROVED")}
            disabled={busy}
            className="btn-primary text-xs px-3 py-1.5"
          >
            Approve
          </button>
          <button onClick={onDenyToggle} disabled={busy} className="btn-neutral text-xs px-3 py-1.5">
            Deny
          </button>
        </div>
      </div>

      {denying && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-black/[0.02] rounded-lg p-3">
          <textarea
            value={denyComment}
            onChange={(e) => onDenyCommentChange(e.target.value)}
            placeholder="Optional note for the team member…"
            rows={2}
            className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={() => onDecide(r.id, "DENIED", denyComment.trim() || undefined)}
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
