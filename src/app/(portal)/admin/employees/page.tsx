import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import EmployeesAdminView from "./EmployeesAdminView";

export default async function AdminEmployeesPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  if (!isAdmin(employee)) redirect("/dashboard");

  return <EmployeesAdminView currentEmployeeId={employee.id} currentEmployeeRole={employee.role} />;
}
