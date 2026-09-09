"use client";

import { useState, useEffect } from "react";
import PtoStatusPill from "@/components/PtoStatusPill";
import TeamNotesThread from "@/components/TeamNotesThread";
import { ChevronDownIcon, ChatIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { AdminPtoRequestDTO, AdminPtoSummaryDTO, PtoType } from "@/types";

type LoadState = "loading" | "ready" | "error";

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

const TYPE_TONE: Record<PtoType, { bg: string; text: string }> = {
  VACATION: { bg: "bg-[color-mix(in_srgb,var(--ttc-blue)_15%,white)]", text: "text-[var(--ttc-blue-ink)]" },
  SICK: { bg: "bg-rose-100", text: "text-rose-800" },
  PERSONAL: { bg: "bg-violet-100", text: "text-violet-800" },
  OTHER_APPROVED_LEAVE: { bg: "bg-amber-100", text: "text-amber-800" },
};

export default function TeamPtoCards({ viewerId }: { viewerId: string }) {
  const [summary, setSummary] = useState<AdminPtoSummaryDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  async function undo(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/pto/requests/${id}/undecide`, { method: "POST" });
    } finally {
      setBusyId(null);
      load();
    }
  }

  if (loadState === "loading") {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface animate-pulse" />
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
              <Card
                key={r.id}
                row={r}
                viewerId={viewerId}
                busy={busyId === r.id}
                denying={denyingId === r.id}
                denyComment={denyComment}
                expanded={expandedId === r.id}
                onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onDenyToggle={() => setDenyingId(denyingId === r.id ? null : r.id)}
                onDenyCommentChange={setDenyComment}
                onDecide={decide}
                onUndo={undo}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Decided ({summary.decided.length})
        </h2>
        {summary.decided.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing decided yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {summary.decided.map((r) => (
              <Card
                key={r.id}
                row={r}
                viewerId={viewerId}
                busy={busyId === r.id}
                denying={false}
                denyComment=""
                expanded={expandedId === r.id}
                onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onDenyToggle={() => {}}
                onDenyCommentChange={() => {}}
                onDecide={() => {}}
                onUndo={undo}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Card({
  row: r,
  viewerId,
  busy,
  denying,
  denyComment,
  expanded,
  onToggleExpand,
  onDenyToggle,
  onDenyCommentChange,
  onDecide,
  onUndo,
}: {
  row: AdminPtoRequestDTO;
  viewerId: string;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (id: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
  onUndo: (id: string) => void;
}) {
  const avatarTone = toneForName(r.employeeName);
  const typeTone = TYPE_TONE[r.type];
  const isPending = r.status === "PENDING";

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-start gap-3 min-w-0 text-left flex-1"
          >
            <span
              className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${avatarTone.bg} ${avatarTone.text}`}
            >
              {initialsOf(r.employeeName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold truncate flex items-center gap-1.5">
                {r.employeeName}
                <ChatIcon className={`h-3.5 w-3.5 shrink-0 ${expanded ? "text-accent-ink" : "text-muted"}`} />
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold leading-tight ${typeTone.bg} ${typeTone.text}`}>
                  {PTO_TYPE_LABEL[r.type]}
                </span>
                <span className="text-sm text-muted">
                  {formatDateRange(r.startDate, r.endDate)} · {r.hours} hrs
                </span>
              </div>
              {r.reason && <p className="text-sm text-muted italic mt-1.5">&ldquo;{r.reason}&rdquo;</p>}
              {!isPending && r.reviewComment && (
                <p className="text-sm text-muted italic mt-1.5">Reviewer note: &ldquo;{r.reviewComment}&rdquo;</p>
              )}
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0 sm:pl-2">
            {isPending ? (
              <>
                <button onClick={() => onDecide(r.id, "APPROVED")} disabled={busy} className="btn-primary text-sm px-4 py-2">
                  Approve
                </button>
                <button onClick={onDenyToggle} disabled={busy} className="btn-neutral text-sm px-4 py-2">
                  Deny
                </button>
              </>
            ) : (
              <>
                <PtoStatusPill status={r.status} />
                <button
                  onClick={() => onUndo(r.id)}
                  disabled={busy}
                  className="text-xs font-medium text-muted hover:text-accent-ink underline shrink-0"
                >
                  Undo
                </button>
              </>
            )}
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

      {expanded && (
        <div className="border-t border-border bg-black/[0.02] p-4 sm:p-5">
          <TeamNotesThread employeeId={r.employeeId} viewerId={viewerId} />
        </div>
      )}
    </div>
  );
}
