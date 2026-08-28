import type { PtoStatus } from "@/types";

const STYLE: Record<PtoStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  DENIED: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  CANCELLED: "bg-black/5 text-muted dark:bg-white/5",
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
