import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import PtoAdminView from "./PtoAdminView";

export default async function AdminPtoPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  if (!isAdmin(employee)) redirect("/dashboard");

  return <PtoAdminView />;
}
