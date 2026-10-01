import { requireEmployeeOrRedirect } from "@/lib/auth";
import DirectoryView from "./DirectoryView";

export default async function DirectoryPage() {
  await requireEmployeeOrRedirect();

  return <DirectoryView />;
}
