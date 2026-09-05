import type { AvailabilityStatus } from "@/types";

// Same solid-fill convention as PtoStatusPill (src/components/PtoStatusPill.tsx) — no
// dark: variants, same reasoning documented there.
const STYLE: Record<AvailabilityStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  DENIED: "bg-rose-100 text-rose-800",
};

const LABEL: Record<AvailabilityStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  DENIED: "Denied",
};

export default function AvailabilityStatusPill({ status }: { status: AvailabilityStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
