import type { AvailabilityStatus } from "@/types";

// Same solid-fill convention as PtoStatusPill (src/components/PtoStatusPill.tsx) — no
// dark: variants, same reasoning documented there. CANCELLED reuses PtoStatusPill's exact
// muted treatment too, for the same reason: it's a withdrawn record, not a decision, so it
// shouldn't compete visually with the amber/emerald/rose ones that actually need attention.
const STYLE: Record<AvailabilityStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  DENIED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-black/5 text-muted",
  // Phase 2 (client spec, Sept 2026): same amber "needs a decision" tone as Pending — an
  // Adjustment Requested submission needs a decision too, just from the team member instead of
  // the reviewer this time.
  ADJUSTMENT_REQUESTED: "bg-amber-100 text-amber-800",
};

const LABEL: Record<AvailabilityStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  DENIED: "Denied",
  CANCELLED: "Cancelled",
  ADJUSTMENT_REQUESTED: "Adjustment requested",
};

export default function AvailabilityStatusPill({ status }: { status: AvailabilityStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
