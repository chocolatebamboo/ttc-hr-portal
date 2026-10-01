import { requireEmployeeOrRedirect } from "@/lib/auth";
import TeamListView from "./TeamListView";

export default async function TeamPage() {
  await requireEmployeeOrRedirect();

  return <TeamListView />;
}
