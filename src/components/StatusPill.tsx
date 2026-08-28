import type { TimeEntryStatus } from "@/types";

const STYLE: Record<TimeEntryStatus, string> = {
  IN_PROGRESS: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  AWAITING_APPROVAL: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  RETURNED: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  MISSING_ENTRY: "bg-black/5 text-muted dark:bg-white/5",
};

const LABEL: Record<TimeEntryStatus, string> = {
  IN_PROGRESS: "In Progress",
  AWAITING_APPROVAL: "Awaiting Approval",
  APPROVED: "Approved",
  RETURNED: "Returned",
  MISSING_ENTRY: "Missing Entry",
};

export default function StatusPill({ status }: { status: TimeEntryStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
