import TeamPtoCards from "@/components/TeamPtoCards";

/**
 * The standalone PTO Management admin page — same TeamPtoCards card list (Approve/Deny/Undo,
 * Pending/Decided, inline chat) the dashboard's own Availability widget page now shows admins
 * directly, just with this page's own heading/description on top. Extracted to TeamPtoCards
 * (Sept 2026) so both places render one implementation, not two. `viewerId` is the signed-in
 * admin, passed down from page.tsx — see AvailabilityAdminView for why it's needed.
 *
 * `scope` (Oct 2026, opened to Supervisor — CB: "give him Attendance + PTO Management for his
 * own team"): TeamPtoCards itself already renders correctly scoped data either way (it just
 * fetches /api/admin/pto, and listAdminPto narrows that for a non-admin caller — see that
 * function's own doc comment); this prop only drives the description copy below, same "all" vs
 * "team" split AttendanceAdminView/ReportsView already take from page.tsx.
 */
export default function PtoAdminView({ viewerId, scope }: { viewerId: string; scope: "all" | "team" }) {
  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">PTO Management</h1>
      <p className="text-sm text-muted mb-4">
        {scope === "team"
          ? "Your own team's time-off requests."
          : "Every team member's time-off requests, org-wide — not just one supervisor's team."}
      </p>
      <TeamPtoCards viewerId={viewerId} />
    </div>
  );
}
