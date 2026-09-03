import { redirect } from "next/navigation";

// Time Off was folded into the My Time page (calendar + time-off requests, one page) per
// CB's request — see TimesheetView.tsx. This route is kept only as a redirect so any old
// bookmarks or links to /time-off still land somewhere useful instead of 404ing.
export default function TimeOffPage() {
  redirect("/time");
}
