import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AvailabilityAdminView from "./AvailabilityAdminView";

export default async function AdminAvailabilityPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  if (!isAdmin(employee)) redirect("/dashboard");

  return <AvailabilityAdminView />;
}
