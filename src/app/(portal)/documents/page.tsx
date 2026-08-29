import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import DocumentsView from "./DocumentsView";

export default async function DocumentsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <DocumentsView canManage={isAdmin(employee)} />;
}
