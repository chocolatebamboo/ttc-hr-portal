import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AnnouncementsView from "./AnnouncementsView";

export default async function AnnouncementsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <AnnouncementsView canManage={isAdmin(employee)} />;
}
