import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import TeamAvailabilityCards from "@/components/TeamAvailabilityCards";
import TeamPtoCards from "@/components/TeamPtoCards";
import AvailabilityView from "./AvailabilityView";

/**
 * CB, Sept 2026: "I wanted that dashboard [the bottom-nav Availability tab] to be the same as
 * the pink availability that's on the home dashboard... I basically want to combine the
 * functions for both... same exact same layout." Before this, the bottom-nav tab always showed
 * AvailabilityView (the employee's own self-serve submit-availability widget) regardless of who
 * was signed in — so an admin tapping "Availability" next to Home never saw the team review
 * queue (Approve/Deny, per-date tasks, adjust time) that the dashboard's own pink "Availability"
 * stat tile already led to at /dashboard/availability. That page now just redirects here (see
 * its own doc comment) so there's truly one destination, reached the same way from both entry
 * points, rather than two different pages that happened to cover related ground. Same branch
 * /dashboard/availability's admin case already used — TeamAvailabilityCards + TeamPtoCards,
 * unchanged — just without that page's own "← Home" link, since this is now itself the primary
 * nav destination, not a page reached FROM the dashboard.
 */
export default async function AvailabilityPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  if (isAdmin(employee)) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title text-2xl mb-4">Availability</h1>
        <div>
          <h2 className="text-sm font-medium text-muted mb-2">Availability requests</h2>
          <TeamAvailabilityCards viewerId={employee.id} />
        </div>
        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted mb-2">Time off requests</h2>
          <TeamPtoCards viewerId={employee.id} />
        </div>
      </div>
    );
  }

  return <AvailabilityView employeeId={employee.id} />;
}
