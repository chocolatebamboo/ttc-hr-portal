"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { describeSlots } from "@/lib/availability-format";
import type { AdminAvailabilityDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** Cycles the same five brand tones the dashboard's Quick Actions chips already use
 *  (CHIP_TONE in dashboard/page.tsx), keyed off the name so a given person's avatar color is
 *  stable across a reload rather than reshuffling. AdminAvailabilityDTO only carries
 *  employeeName (not a photo or id-stable field worth hashing on), so the name is what's
 *  available to key off of here. */
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
 * The HR-wide availability roster's actual card list — fetch, Approve/Deny, Pending/Decided
 * sections — extracted from AvailabilityAdminView (Sept 2026) so it can be dropped straight
 * onto the dashboard's own Availability widget page for admins, not just the standalone
 * /admin/availability page. CB: "when we go on the pink availability block, that's where I
 * want those things to show... it's not supposed to be a whole different thing where we have
 * to do extra steps." AvailabilityAdminView and this dashboard widget page both just render
 * this component now, so there's one card implementation, not two to keep in sync.
 */
export default function TeamAvailabilityCards() {
  const [pending, setPending] = useState<AdminAvailabilityDTO[]>([]);
  const [decided, setDecided] = useState<AdminAvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");

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
          Decided ({decided.length})
        </h2>
        {decided.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            Nothing decided yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {decided.map((r) => (
              <Card key={r.id} row={r} busy={false} denying={false} denyComment="" onDenyToggle={() => {}} onDenyCommentChange={() => {}} onDecide={() => {}} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Card({
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
  onDecide: (submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
}) {
  const lines = describeSlots(r.slots);
  const tone = toneForName(r.employeeName);
  const isPending = r.status === "PENDING";

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${tone.bg} ${tone.text}`}
          >
            {initialsOf(r.employeeName)}
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold truncate">
              <Link href={`/team/${r.employeeId}`} className="hover:underline">
                {r.employeeName}
              </Link>
            </p>
            {/* Each submitted day on its own line rather than one long "Mon ... · Wed ... ·
                Fri ..." run-on string — CB (Sept 2026) flagged that a multi-day submission
                read as one dense, hard-to-scan line here. */}
            <div className="mt-1 space-y-0.5">
              {lines.length > 0 ? (
                lines.map((line, i) => (
                  <p key={i} className="text-sm text-muted">
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted">No dates marked available.</p>
              )}
            </div>
            {r.note && <p className="text-sm text-muted italic mt-1.5">&ldquo;{r.note}&rdquo;</p>}
            {!isPending && r.reviewComment && (
              <p className="text-sm text-muted italic mt-1.5">Reviewer note: &ldquo;{r.reviewComment}&rdquo;</p>
            )}
          </div>
        </div>

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
            <AvailabilityStatusPill status={r.status} />
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
  );
}
