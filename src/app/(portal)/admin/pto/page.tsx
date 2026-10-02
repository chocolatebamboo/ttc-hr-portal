import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin, canAccessPtoManagement } from "@/lib/authorization";
import PtoAdminView from "./PtoAdminView";

export default async function AdminPtoPage() {
  const employee = await requireEmployeeOrRedirect();
  // Opened to Supervisor too (Oct 2026, CB) — see canAccessPtoManagement's own doc comment in
  // src/lib/authorization.ts.
  if (!canAccessPtoManagement(employee)) redirect("/dashboard");

  // Same "all" vs "team" scope AttendanceAdminView/ReportsView already take from this exact
  // isAdmin check — drives PtoAdminView's own copy, see that file's own doc comment.
  return <PtoAdminView viewerId={employee.id} scope={isAdmin(employee) ? "all" : "team"} />;
}
