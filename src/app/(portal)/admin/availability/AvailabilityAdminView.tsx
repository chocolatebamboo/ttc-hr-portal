import TeamAvailabilityCards from "@/components/TeamAvailabilityCards";

/**
 * The standalone Team Availability admin page — same TeamAvailabilityCards card list
 * (Approve/Deny/Undo, Pending/Decided, inline chat) the dashboard's own Availability widget
 * page now shows admins directly, just with this page's own heading/description on top.
 * Extracted to TeamAvailabilityCards (Sept 2026) so both places render one implementation, not
 * two. `viewerId` is the signed-in admin, passed down from page.tsx (getCurrentEmployee runs
 * server-side there) so the inline chat thread knows which side of the conversation is "you."
 *
 * `scope` (Oct 2026, opened to Supervisor — see canAccessTeamAvailability's own doc comment in
 * src/lib/authorization.ts): TeamAvailabilityCards itself already renders correctly scoped data
 * either way (it fetches /api/admin/availability, and listAdminAvailability narrows that for a
 * non-admin caller — see that function's own doc comment); this prop only drives the description
 * copy below, same "all" vs "team" split AttendanceAdminView/PtoAdminView/ReportsView already
 * take from page.tsx.
 */
export default function AvailabilityAdminView({ viewerId, scope }: { viewerId: string; scope: "all" | "team" }) {
  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">Team Availability</h1>
      <p className="text-sm text-muted mb-4">
        {scope === "team"
          ? "Your own team's submitted availability. Purely informational: nothing here is enforced against scheduling."
          : "Every team member's submitted availability, org-wide — not just one supervisor's team. Purely informational: nothing here is enforced against scheduling."}
      </p>
      <TeamAvailabilityCards viewerId={viewerId} />
    </div>
  );
}
