import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import PtoView from "./PtoView";

export default async function TimeOffPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <PtoView />;
}
