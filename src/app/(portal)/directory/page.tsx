import { requireEmployeeOrRedirect } from "@/lib/auth";
import DirectoryView from "./DirectoryView";

export default async function DirectoryPage() {
  const employee = await requireEmployeeOrRedirect();

  // Oct 2026: viewerId lets DirectoryView hide the new "Message" shortcut on the viewer's own
  // row — same "not shown on the viewer's own card, messaging yourself isn't a real
  // conversation" rule TeamAvailabilityCards' own chat button already follows (see its doc
  // comment on isSelf).
  return <DirectoryView viewerId={employee.id} />;
}
