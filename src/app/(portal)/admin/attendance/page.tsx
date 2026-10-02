import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin, canAccessAttendance } from "@/lib/authorization";
import AttendanceAdminView from "./AttendanceAdminView";

export default async function AdminAttendancePage() {
  const employee = await requireEmployeeOrRedirect();
  // Same as Reports: nothing here for someone with neither role to fall back to, so redirect
  // outright. Opened to Supervisor too (Oct 2026, CB) — see canAccessAttendance's own doc
  // comment in src/lib/authorization.ts.
  if (!canAccessAttendance(employee)) redirect("/dashboard");

  // Same "all" vs "team" scope ReportsView already takes from this exact isAdmin check — drives
  // AttendanceAdminView's own copy so a Supervisor doesn't read "every active team member" when
  // what's actually on screen is just their own reports.
  return <AttendanceAdminView scope={isAdmin(employee) ? "all" : "team"} />;
}
