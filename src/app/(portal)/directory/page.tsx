import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import DirectoryView from "./DirectoryView";

export default async function DirectoryPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <DirectoryView />;
}
