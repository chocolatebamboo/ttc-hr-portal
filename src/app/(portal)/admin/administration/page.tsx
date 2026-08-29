import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AdministrationView from "./AdministrationView";

export default async function AdministrationPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  if (!isAdmin(employee)) redirect("/dashboard");

  return <AdministrationView />;
}
