import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import { listTeamNoteTopicCounts, listAllTeamNoteTopicCounts } from "@/lib/team-notes";
import { listConversationSummaries } from "@/lib/direct-messages";
import MessagesInboxView from "./MessagesInboxView";

/** CB, Sept 2026: "a messages portal similar to where we could see all the different messages
 *  for its respective day" — every per-date/per-request conversation in one place, reached
 *  from the icon on the dashboard (dashboard/page.tsx). Admins see every employee's
 *  conversations; everyone else sees just their own, same split listTeamNoteTopicCounts vs.
 *  listAllTeamNoteTopicCounts already draws for the dashboard's own notification count.
 *  Extended this round: "instead of notes, I want it to be messages... look up members and
 *  send them individual messages... have an internal conversation there" — this now also
 *  fetches every real peer-to-peer DM conversation (listConversationSummaries) alongside the
 *  existing topic conversations, in parallel, so MessagesInboxView can render one unified
 *  inbox rather than two separate pages. */
export default async function MessagesPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const [topicCounts, directConversations] = await Promise.all([
    isAdmin(employee) ? listAllTeamNoteTopicCounts(employee) : listTeamNoteTopicCounts(employee, employee.id),
    listConversationSummaries(employee),
  ]);

  return (
    <MessagesInboxView
      viewerId={employee.id}
      viewerName={employee.preferredName || employee.firstName}
      topicCounts={topicCounts}
      directConversations={directConversations}
    />
  );
}
