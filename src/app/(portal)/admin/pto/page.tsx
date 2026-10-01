import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import PtoAdminView from "./PtoAdminView";

export default async function AdminPtoPage() {
  const employee = await requireEmployeeOrRedirect();
  if (!isAdmin(employee)) redirect("/dashboard");

  return <PtoAdminView viewerId={employee.id} />;
}
