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

// QA pass (Sept 2026), CB: "I don't see where it has pending and whatnot" — MyAvailabilityPreview
// sits this pill on top of a solid colored gradient card that's the SAME hue as the tinted
// STYLE above (amber-on-amber, pink-on-pink, rose-on-rose), so the pill nearly disappears
// regardless of status. That readability bug predates this pill being always-visible on the
// redesigned Availability page — it was just never obvious while this list lived behind a
// collapsed accordion. Same fix TeamAvailabilityCards/MyAvailabilityPreview's own "Accept" button
// already use for a control on top of one of these gradient cards: solid white, tone-colored
// text, real contrast against any of the three hues.
const ON_COLOR_TEXT: Record<AvailabilityStatus, string> = {
  PENDING: "#b45309", // amber-700, matches STATUS_TONE.PENDING.to
  APPROVED: "var(--ttc-pink-ink)",
  DENIED: "#be123c", // rose-700, matches STATUS_TONE.DENIED.to
  CANCELLED: "#475569", // slate-600, matches STATUS_TONE.CANCELLED.to
  ADJUSTMENT_REQUESTED: "#b45309",
  REMOVED: "#475569",
};

export default function AvailabilityStatusPill({
  status,
  awaitingTask,
  onColor = false,
}: {
  status: AvailabilityStatus;
  /** Two-step approval workflow (CB, Sept 2026): pass this true only on the team member's own
   *  view (AvailabilityDTO.awaitingTask, set by listMyAvailability) — an Approved submission
   *  keeps reading as "still in progress" until a task's actually been pushed for it, since
   *  that's the step that confirms the shift. Admin-facing call sites never pass this, so their
   *  pill always reads the real status straight, which is correct there. */
  awaitingTask?: boolean;
  /** True when this pill renders on top of a solid same-hue gradient card (MyAvailabilityPreview's
   *  colored cards) rather than a plain white/bordered one — switches to the high-contrast solid-
   *  white-pill treatment instead of the tinted STYLE above, which only reads on a light surface. */
  onColor?: boolean;
}) {
  const effectiveStatus = status === "APPROVED" && awaitingTask ? "PENDING" : status;
  const label = effectiveStatus === "PENDING" && status === "APPROVED" ? "Approved" : LABEL[effectiveStatus];
  if (onColor) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold shadow-sm"
        style={{ color: ON_COLOR_TEXT[effectiveStatus] }}
      >
        {label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[effectiveStatus]}`}>
      {label}
    </span>
  );
}
