import type { AvailabilityStatus } from "@/types";

// Same solid-fill convention as PtoStatusPill (src/components/PtoStatusPill.tsx) — no
// dark: variants, same reasoning documented there. CANCELLED reuses PtoStatusPill's exact
// muted treatment too, for the same reason: it's a withdrawn record, not a decision, so it
// shouldn't compete visually with the amber/pink/rose ones that actually need attention.
// CB, Sept 2026: unified APPROVED to brand pink (matching STATUS_TONE in
// src/lib/status-tone.ts, already used on the admin-facing team cards) instead of the emerald
// this used to be — one color vocabulary for "approved" everywhere.
const STYLE: Record<AvailabilityStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-accent/15 text-accent-ink",
  DENIED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-black/5 text-muted",
  // Phase 2 (client spec, Sept 2026): same amber "needs a decision" tone as Pending — an
  // Adjustment Requested submission needs a decision too, just from the team member instead of
  // the reviewer this time.
  ADJUSTMENT_REQUESTED: "bg-amber-100 text-amber-800",
  // Correction brief #10 (Sept 2026): included only to keep this a complete
  // Record<AvailabilityStatus, ...> — every list this component's data comes from
  // (listMyAvailability/listAvailabilityForEmployee/listAdminAvailability) filters REMOVED rows
  // out server-side, so this entry is never actually looked up. Same reasoning
  // AvailabilityCalendar.tsx's STATUS_CHIP documents for its own unreachable CANCELLED entry.
  REMOVED: "bg-black/5 text-muted",
};

const LABEL: Record<AvailabilityStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  DENIED: "Denied",
  CANCELLED: "Cancelled",
  ADJUSTMENT_REQUESTED: "Adjustment requested",
  REMOVED: "Removed",
};

export default function AvailabilityStatusPill({
  status,
  awaitingTask,
}: {
  status: AvailabilityStatus;
  /** Two-step approval workflow (CB, Sept 2026): pass this true only on the team member's own
   *  view (AvailabilityDTO.awaitingTask, set by listMyAvailability) — an Approved submission
   *  keeps reading as "still in progress" until a task's actually been pushed for it, since
   *  that's the step that confirms the shift. Admin-facing call sites never pass this, so their
   *  pill always reads the real status straight, which is correct there. */
  awaitingTask?: boolean;
}) {
  const effectiveStatus = status === "APPROVED" && awaitingTask ? "PENDING" : status;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[effectiveStatus]}`}>
      {effectiveStatus === "PENDING" && status === "APPROVED" ? "Approved" : LABEL[effectiveStatus]}
    </span>
  );
}
