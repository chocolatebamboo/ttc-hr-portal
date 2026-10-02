import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin, canAccessTeamAvailability } from "@/lib/authorization";
import AvailabilityAdminView from "./AvailabilityAdminView";

export default async function AdminAvailabilityPage() {
  const employee = await requireEmployeeOrRedirect();
  // Opened to Supervisor too (Oct 2026, CB, comparing Daijour's sidebar to her own: "it's not
  // looking exactly kind of like mine where the team availability is the main and then the
  // breakdown") — see canAccessTeamAvailability's own doc comment in src/lib/authorization.ts.
  if (!canAccessTeamAvailability(employee)) redirect("/dashboard");

  // Same "all" vs "team" scope AttendanceAdminView/PtoAdminView/ReportsView already take from
  // this exact isAdmin check — drives AvailabilityAdminView's own copy below.
  return <AvailabilityAdminView viewerId={employee.id} scope={isAdmin(employee) ? "all" : "team"} />;
}
