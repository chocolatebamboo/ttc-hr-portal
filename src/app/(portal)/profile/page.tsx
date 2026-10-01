import { requireEmployeeOrRedirect } from "@/lib/auth";
import ProfileView from "./ProfileView";

export default async function ProfilePage() {
  await requireEmployeeOrRedirect();

  return <ProfileView />;
}
