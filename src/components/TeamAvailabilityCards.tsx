"use client";

import { useState, useEffect } from "react";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import TeamNotesThread from "@/components/TeamNotesThread";
import { ChevronDownIcon, ChatIcon } from "@/components/icons";
import { slotChips } from "@/lib/availability-format";
import type { AdminAvailabilityDTO } from "@/types";

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

export default function TeamAvailabilityCards({ viewerId }: { viewerId: string }) {
  const [pending, setPending] = useState<AdminAvailabilityDTO[]>([]);
  const [decided, setDecided] = useState<AdminAvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/availability");
      if (!res.ok) throw new Error();
      const data: { pending: AdminAvailabilityDTO[]; decided: AdminAvailabilityDTO[] } = await res.json();
      setPending(data.pending);
      setDecided(data.decided);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

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

  async function undo(submissionId: string) {
    setBusyId(submissionId);
    try {
      await fetch(`/api/availability/${submissionId}/undecide`, { method: "POST" });
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

  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load availability. Please try again or contact support.
      </div>
    );
  }

  return (
    <>
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing pending right now.
          </div>
        ) : (
          <div className="space-y-2.5">
            {pending.map((r) => (
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
          Decided ({decided.length})
        </h2>
        {decided.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing decided yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {decided.map((r) => (
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
  row: AdminAvailabilityDTO;
  viewerId: string;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
  onUndo: (submissionId: string) => void;
}) {
  const chips = slotChips(r.slots);
  const tone = toneForName(r.employeeName);
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
              className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${tone.bg} ${tone.text}`}
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
              {chips.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {chips.map((c, i) => (
                    <span
                      key={i}
                      className={`inline-flex flex-col items-start rounded-lg px-2.5 py-1 leading-tight ${tone.bg} ${tone.text}`}
                    >
                      <span className="text-xs font-semibold">{c.dateLabel}</span>
                      <span className="text-[11px] opacity-80">{c.timeLabel}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted mt-1">No dates marked available.</p>
              )}
              {r.note && <p className="text-sm text-muted italic mt-1.5">&ldquo;{r.note}&rdquo;</p>}
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
                <AvailabilityStatusPill status={r.status} />
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
