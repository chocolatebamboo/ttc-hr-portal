import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import ProfileView from "./ProfileView";

export default async function ProfilePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return <ProfileView />;
}
