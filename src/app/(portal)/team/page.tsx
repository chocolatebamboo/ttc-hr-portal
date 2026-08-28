import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import TeamListView from "./TeamListView";

export default async function TeamPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <TeamListView />;
}
