import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import AnnouncementsView from "./AnnouncementsView";

export default async function AnnouncementsPage() {
  const employee = await requireEmployeeOrRedirect();

  return <AnnouncementsView canManage={isAdmin(employee)} />;
}
