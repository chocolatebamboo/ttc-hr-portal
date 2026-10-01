import { redirect } from "next/navigation";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AdministrationView from "./AdministrationView";

export default async function AdministrationPage() {
  const employee = await requireEmployeeOrRedirect();
  if (!isAdmin(employee)) redirect("/dashboard");

  return <AdministrationView />;
}
