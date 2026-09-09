"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PtoStatusPill from "@/components/PtoStatusPill";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { AdminPtoRequestDTO, AdminPtoSummaryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** Same avatar-tone treatment as TeamAvailabilityCards' Card (Sept 2026 card redesign) —
 *  cycling the dashboard's five brand tones (CHIP_TONE in dashboard/page.tsx), keyed off the
 *  name so it stays stable across a reload. Kept as its own local copy rather than a shared
 *  import, matching how initialsOf is already duplicated locally in EmployeesAdminView. */
const AVATAR_TONES = [
  { bg: "bg-[color-mix(in_srgb,var(--ttc-blue)_15%,white)]", text: "text-[var(--ttc-blue-ink)]" },
  { bg: "bg-[color-mix(in_srgb,var(--ttc-pink)_15%,white)]", text: "text-[var(--ttc-pink-ink)]" },
  { bg: "bg-amber-100", text: "text-amber-800" },
  { bg: "bg-emerald-100", text: "text-emerald-800" },
  { bg: "bg-violet-100", text: "text-violet-800" },
];

function toneForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * The HR-wide PTO dashboard's actual card list — fetch, Approve/Deny, Pending/Upcoming
 * sections — extracted from PtoAdminView (Sept 2026) so it can be dropped straight onto the
 * dashboard's own Availability widget page for admins, not just the standalone /admin/pto
 * page. Same reasoning as TeamAvailabilityCards: one card implementation, reused in both
 * places, rather than two copies to keep in sync.
 */
export default function TeamPtoCards() {
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

  if (loadState === "loading") {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error" || !summary) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load PTO requests. Please try again or contact support.
      </div>
    );
  }

  return (
    <>
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Pending ({summary.pending.length})
        </h2>
        {summary.pending.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing pending right now.
          </div>
        ) : (
          <div className="space-y-2.5">
            {summary.pending.map((r) => (
              <PendingCard
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Upcoming approved leave ({summary.upcoming.length})
        </h2>
        {summary.upcoming.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            No approved time off scheduled from today onward.
          </div>
        ) : (
          <div className="space-y-2.5">
            {summary.upcoming.map((r) => {
              const tone = toneForName(r.employeeName);
              return (
                <div
                  key={r.id}
                  className="bg-surface border border-border rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${tone.bg} ${tone.text}`}
                    >
                      {initialsOf(r.employeeName)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        <Link href={`/team/${r.employeeId}`} className="hover:underline">
                          {r.employeeName}
                        </Link>{" "}
                        · {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
                      </p>
                      <p className="text-xs text-muted">
                        {r.hours} hours{r.reason ? ` — ${r.reason}` : ""}
                      </p>
                    </div>
                  </div>
                  <PtoStatusPill status={r.status} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function PendingCard({
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
  const tone = toneForName(r.employeeName);
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${tone.bg} ${tone.text}`}
          >
            {initialsOf(r.employeeName)}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              <Link href={`/team/${r.employeeId}`} className="hover:underline">
                {r.employeeName}
              </Link>{" "}
              · {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
            </p>
            <p className="text-xs text-muted">
              {r.hours} hours{r.reason ? ` — ${r.reason}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onDecide(r.id, "APPROVED")}
            disabled={busy}
            className="btn-primary text-sm px-4 py-2"
          >
            Approve
          </button>
          <button onClick={onDenyToggle} disabled={busy} className="btn-neutral text-sm px-4 py-2">
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
            className="btn-primary text-sm px-4 py-2 self-start"
          >
            Confirm deny
          </button>
        </div>
      )}
    </div>
  );
}
