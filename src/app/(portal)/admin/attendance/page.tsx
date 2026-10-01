import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AttendanceAdminView from "./AttendanceAdminView";

export default async function AdminAttendancePage() {
  const employee = await requireEmployeeOrRedirect();
  // Same as Reports: nothing here for a non-admin to fall back to, so redirect outright.
  if (!isAdmin(employee)) redirect("/dashboard");

  return <AttendanceAdminView />;
}
