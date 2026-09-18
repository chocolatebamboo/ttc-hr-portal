import { redirect } from "next/navigation";

// Correction brief #6 (Sept 2026), "Consolidate Availability and My Time": My Time's useful
// functionality (the "Logged hours" summary; Time Off was already shared) moved into
// Availability — see AvailabilityView.tsx and LoggedHoursSection.tsx. This route is kept only
// as a redirect, same convention as /time-off below it, so any old bookmarks or links to /time
// still land somewhere useful instead of 404ing.
export default function TimePage() {
  redirect("/availability");
}
