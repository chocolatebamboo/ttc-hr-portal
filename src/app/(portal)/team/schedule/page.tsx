import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import TeamScheduleView from "./TeamScheduleView";

/** Team Schedule — phase 1 of the scheduling workflow rebuild. Unlike /admin/* pages (which
 *  gate to isAdmin() only), this is for supervisors too: the client spec lists "Manage...
 *  shifts... for Team Members under their supervision" as a Supervisor capability, not an
 *  Admin-only one — see this page's own href living in both SUPERVISOR_NAV and ADMIN_NAV
 *  (src/lib/nav.ts), one page, gated by role instead of two competing ones. */
export default async function TeamSchedulePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  if (!isAdmin(employee) && employee.role !== "SUPERVISOR") redirect("/dashboard");

  return <TeamScheduleView viewerIsAdmin={isAdmin(employee)} />;
}
