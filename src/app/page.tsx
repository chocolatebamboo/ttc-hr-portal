import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";

export default async function RootPage() {
  const employee = await getCurrentEmployee();
  redirect(employee ? "/dashboard" : "/login");
}
