import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AvailabilityAdminView from "./AvailabilityAdminView";

export default async function AdminAvailabilityPage() {
  const employee = await requireEmployeeOrRedirect();
  if (!isAdmin(employee)) redirect("/dashboard");

  return <AvailabilityAdminView viewerId={employee.id} />;
}
