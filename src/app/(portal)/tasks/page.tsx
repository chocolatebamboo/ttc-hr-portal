import { requireEmployeeOrRedirect } from "@/lib/auth";
import { canSeeAdminHomeDashboard } from "@/lib/authorization";
import MyTasksView from "./MyTasksView";

export default async function MyTasksPage() {
  const employee = await requireEmployeeOrRedirect();

  // Oct 2026 (CB: "I should be able to approve as well on the tasks page as well" — until now
  // the only place to approve a task was buried inside that employee's own date on Availability/
  // Schedule): same admin-or-SUPERVISOR gate as the dashboard's own admin sections, so Daijour
  // sees it too, not just Shawn.
  return <MyTasksView employeeId={employee.id} canReview={canSeeAdminHomeDashboard(employee)} />;
}
