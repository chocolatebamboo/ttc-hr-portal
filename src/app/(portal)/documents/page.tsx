import { requireEmployeeOrRedirect } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import DocumentsView from "./DocumentsView";

export default async function DocumentsPage() {
  const employee = await requireEmployeeOrRedirect();

  return <DocumentsView canManage={isAdmin(employee)} />;
}
