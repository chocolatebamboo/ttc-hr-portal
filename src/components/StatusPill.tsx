import type { TimeEntryStatus } from "@/types";

// See PtoStatusPill for why there's no dark: variant here anymore — this app doesn't switch
// palettes with the visitor's OS setting, and the dark: classes were making these pills wash
// out against the light page background regardless of intent.
const STYLE: Record<TimeEntryStatus, string> = {
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  AWAITING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  RETURNED: "bg-rose-100 text-rose-800",
  MISSING_ENTRY: "bg-black/5 text-muted",
};

// CB, Oct 2026, looking at a review table full of these on a team member's Timesheet tab:
// "missing entry almost seems like you're saying there's something wrong." The only live
// caller that ever synthesizes MISSING_ENTRY (TimesheetTable.tsx, for a calendar day with no
// real TimeEntry) now skips this pill entirely for a day that hasn't happened yet — see that
// file's own doc comment — so by the time this label shows at all, the day is genuinely in the
// past with nothing logged for it. "Not Logged" says exactly that without reading as an
// accusation the way "Missing" did.
const LABEL: Record<TimeEntryStatus, string> = {
  IN_PROGRESS: "In Progress",
  AWAITING_APPROVAL: "Awaiting Approval",
  APPROVED: "Approved",
  RETURNED: "Returned",
  MISSING_ENTRY: "Not Logged",
};

export default function StatusPill({ status }: { status: TimeEntryStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
