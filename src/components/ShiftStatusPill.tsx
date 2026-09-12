import type { ShiftStatus } from "@/types";

// Same solid-fill pill convention as AvailabilityStatusPill/PtoStatusPill. Colors follow the
// same logic those two already use (amber = needs a decision, rose = something went wrong,
// muted = closed out) plus two new ones this status set needs: emerald for "happening right
// now" (In Progress) and violet for Reassigned, matching the violet DirectMessage/messaging
// accent already used elsewhere in this app for "moved to somewhere/someone else."
const STYLE: Record<ShiftStatus, string> = {
  UPCOMING: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-black/5 text-muted",
  CHANGE_REQUESTED: "bg-amber-100 text-amber-800",
  CANCELLATION_REQUESTED: "bg-amber-100 text-amber-800",
  CANCELLED: "bg-black/5 text-muted",
  REASSIGNED: "bg-violet-100 text-violet-800",
  MISSED: "bg-rose-100 text-rose-800",
};

const LABEL: Record<ShiftStatus, string> = {
  UPCOMING: "Upcoming",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CHANGE_REQUESTED: "Change requested",
  CANCELLATION_REQUESTED: "Cancellation requested",
  CANCELLED: "Cancelled",
  REASSIGNED: "Reassigned",
  MISSED: "Missed",
};

/** Renders the shift's DISPLAY status (ShiftDTO.displayStatus), not its raw stored one — see
 *  that field's own doc comment in src/types/index.ts. Every call site in this app should be
 *  passing displayStatus here, not status. */
export default function ShiftStatusPill({ status }: { status: ShiftStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
