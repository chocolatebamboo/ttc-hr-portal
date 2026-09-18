import { redirect } from "next/navigation";

// Time Off was folded into the Availability page (Time Off is one of its four accordion
// sections — see AvailabilityView.tsx). Redirects straight to /availability rather than through
// /time (which now just redirects here too, per correction brief #6, Sept 2026) so an old link
// lands in one hop instead of two. This route is kept only as a redirect so any old bookmarks
// or links to /time-off still land somewhere useful instead of 404ing.
export default function TimeOffPage() {
  redirect("/availability");
}
