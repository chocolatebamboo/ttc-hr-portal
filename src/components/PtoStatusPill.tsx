import type { PtoStatus } from "@/types";

// Solid, higher-contrast fills (no dark: variants — this app has no dark-mode toggle, and
// Tailwind's dark: classes were silently triggering off visitors' OS/browser color-scheme
// setting, which is what made "Pending" wash out against the page's now-permanently-light
// background). Bumped a shade up from the original 50/700 pairing so each status reads
// clearly at a glance instead of blending into white.
const STYLE: Record<PtoStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  DENIED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-black/5 text-muted",
};

const LABEL: Record<PtoStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DENIED: "Denied",
  CANCELLED: "Cancelled",
};

export default function PtoStatusPill({ status }: { status: PtoStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
