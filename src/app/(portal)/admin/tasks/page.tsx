import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin, canAccessTeamTasks } from "@/lib/authorization";
import TeamTasksView from "./TeamTasksView";

/** Team Tasks (src/lib/date-tasks.ts's own listTeamDateTasksForPeriod doc comment has the full
 *  story) — CB, Oct 2026: "the admin's team member tasks... so we could see the team members
 *  task... holistic with all the different team members." Same guard shape as Attendance/PTO
 *  Management/Team Availability's own admin pages: nothing here for someone with neither role
 *  to fall back to, so redirect outright. */
export default async function AdminTasksPage() {
  const employee = await requireEmployeeOrRedirect();
  if (!canAccessTeamTasks(employee)) redirect("/dashboard");

  // Same "all" vs "team" scope ReportsView/AttendanceAdminView already take from this exact
  // isAdmin check — drives TeamTasksView's own copy so a Supervisor doesn't read "every team
  // member" when what's actually on screen is just their own reports.
  return <TeamTasksView scope={isAdmin(employee) ? "all" : "team"} viewerId={employee.id} />;
}
