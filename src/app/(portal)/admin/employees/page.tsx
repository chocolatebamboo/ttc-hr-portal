import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import EmployeesAdminView from "./EmployeesAdminView";

export default async function AdminEmployeesPage() {
  const employee = await requireEmployeeOrRedirect();
  if (!isAdmin(employee)) redirect("/dashboard");

  return <EmployeesAdminView currentEmployeeId={employee.id} currentEmployeeRole={employee.role} />;
}
