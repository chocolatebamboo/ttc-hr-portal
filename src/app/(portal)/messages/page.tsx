import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import { listTeamNoteTopicCounts, listAllTeamNoteTopicCounts } from "@/lib/team-notes";
import MessagesInboxView from "./MessagesInboxView";

/** CB, Sept 2026: "a messages portal similar to where we could see all the different messages
 *  for its respective day" — every per-date/per-request conversation in one place, reached
 *  from the icon on the dashboard (dashboard/page.tsx). Admins see every employee's
 *  conversations; everyone else sees just their own, same split listTeamNoteTopicCounts vs.
 *  listAllTeamNoteTopicCounts already draws for the dashboard's own notification count. */
export default async function MessagesPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const counts = isAdmin(employee)
    ? await listAllTeamNoteTopicCounts(employee)
    : await listTeamNoteTopicCounts(employee, employee.id);

  return <MessagesInboxView viewerId={employee.id} counts={counts} />;
}
