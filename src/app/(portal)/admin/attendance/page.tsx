import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AttendanceAdminView from "./AttendanceAdminView";

export default async function AdminAttendancePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  // Same as Reports: nothing here for a non-admin to fall back to, so redirect outright.
  if (!isAdmin(employee)) redirect("/dashboard");

  return <AttendanceAdminView />;
}
