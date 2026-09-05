"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { describeSlots } from "@/lib/availability-format";
import type { AdminAvailabilityDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/**
 * HR-wide availability roster — every team member who's submitted a weekly pattern, org-wide,
 * not just one supervisor's team (same relationship PtoAdminView has to TeamPtoSection).
 * Deciding here reuses /api/availability/[employeeId]/decide, the same endpoint a supervisor
 * uses on TeamAvailabilitySection — an HR/Super Admin passes assertCanReviewAvailability's
 * admin bypass for any employee.
 */
export default function AvailabilityAdminView() {
  const [rows, setRows] = useState<AdminAvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/availability");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRows(data.availability);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function decide(employeeId: string, decision: "APPROVED" | "DENIED", comment?: string) {
    setBusyId(employeeId);
    try {
      await fetch(`/api/availability/${employeeId}/decide`, {
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

  const pending = rows.filter((r) => r.status === "PENDING");
  const decided = rows.filter((r) => r.status !== "PENDING");

  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">Availability</h1>
      <p className="text-sm text-muted mb-4">
        Every team member&apos;s submitted weekly availability, org-wide — not just one
        supervisor&apos;s team. Purely informational: nothing here is enforced against
        scheduling.
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
          Unable to load availability. Please try again or contact support.
        </div>
      )}

      {loadState === "ready" && (
        <>
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">
              Pending ({pending.length})
            </h2>
            {pending.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
                Nothing pending right now.
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
                {pending.map((r) => (
                  <Row
                    key={r.employeeId}
                    row={r}
                    busy={busyId === r.employeeId}
                    denying={denyingId === r.employeeId}
                    denyComment={denyComment}
                    onDenyToggle={() => setDenyingId(denyingId === r.employeeId ? null : r.employeeId)}
                    onDenyCommentChange={setDenyComment}
                    onDecide={decide}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">
              Decided ({decided.length})
            </h2>
            {decided.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
                Nothing decided yet.
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
                {decided.map((r) => (
                  <div key={r.employeeId} className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">
                        <Link href={`/team/${r.employeeId}`} className="hover:underline">
                          {r.employeeName}
                        </Link>
                      </p>
                      <AvailabilityStatusPill status={r.status} />
                    </div>
                    <p className="text-xs text-muted mt-0.5">{describeSlots(r.slots).join(" · ") || "No days marked available."}</p>
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

function Row({
  row: r,
  busy,
  denying,
  denyComment,
  onDenyToggle,
  onDenyCommentChange,
  onDecide,
}: {
  row: AdminAvailabilityDTO;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (employeeId: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
}) {
  const lines = describeSlots(r.slots);
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            <Link href={`/team/${r.employeeId}`} className="hover:underline">
              {r.employeeName}
            </Link>
          </p>
          <p className="text-xs text-muted">{lines.join(" · ") || "No days marked available."}</p>
          {r.note && <p className="text-xs text-muted mt-0.5">&ldquo;{r.note}&rdquo;</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => onDecide(r.employeeId, "APPROVED")} disabled={busy} className="btn-primary text-xs px-3 py-1.5">
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
            onClick={() => onDecide(r.employeeId, "DENIED", denyComment.trim() || undefined)}
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
