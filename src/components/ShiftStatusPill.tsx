import { CheckCircleIcon } from "@/components/icons";
import type { ShiftStatus } from "@/types";

// Same solid-fill pill convention as AvailabilityStatusPill/PtoStatusPill. Colors follow the
// same logic those two already use (amber = needs a decision, rose = something went wrong,
// muted = closed out) plus two new ones this status set needs: emerald for "happening right
// now" (In Progress) and violet for Reassigned, matching the violet DirectMessage/messaging
// accent already used elsewhere in this app for "moved to somewhere/someone else."
//
// Round 2 (CB, Oct 2026, from a live screenshot: "when something is completed, I want it to be
// green with a checkmark next to it... there needs to be a clear differentiation"): Completed
// used to share the same muted gray as Cancelled — both "closed out," but one of those is a
// shift that actually happened and the other isn't, and at a glance they read identically. Given
// its own green (distinct from In Progress's emerald, so the two "good news" shifts don't become
// the same pill with different words) plus CheckCircleIcon below, same icon this app already uses
// for "this is done" everywhere else My Tasks' CHECK_CIRCLE-style completion marks appear.
const STYLE: Record<ShiftStatus, string> = {
  UPCOMING: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-green-100 text-green-800",
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
  // Oct 2026 (CB): "Missed" read as an accusation to her when a shift just never got clocked
  // in — she was workshopping alternatives live ("unclocked in... didn't clock in for this
  // one... missed kind of sounds crazy") and picked this plainer, blame-neutral phrasing.
  // Underlying ShiftStatus value stays "MISSED" (storage/derivation/filtering untouched) —
  // this only changes what the pill displays.
  MISSED: "No clock-in",
};

/** Renders the shift's DISPLAY status (ShiftDTO.displayStatus), not its raw stored one — see
 *  that field's own doc comment in src/types/index.ts. Every call site in this app should be
 *  passing displayStatus here, not status. */
export default function ShiftStatusPill({ status }: { status: ShiftStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {status === "COMPLETED" && <CheckCircleIcon className="h-3 w-3" />}
      {LABEL[status]}
    </span>
  );
}
