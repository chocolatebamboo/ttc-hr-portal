import { redirect } from "next/navigation";

/**
 * CB, Sept 2026: "I wanted that dashboard to be the same as the pink availability that's on the
 * home dashboard... combine the functions for both... same exact same layout." The dashboard's
 * pink "Availability" stat tile and the bottom-nav "Availability" tab used to lead to two
 * different pages covering overlapping ground (this one had the real admin review queue; the
 * bottom-nav tab only ever showed an employee's own self-serve widget, even for an admin) — now
 * both lead to the exact same place. See src/app/(portal)/availability/page.tsx's own doc
 * comment for the branch this redirects into (admin: team review queue; everyone else: the
 * self-serve widget).
 */
export default function DashboardAvailabilityRedirect() {
  redirect("/availability");
}
