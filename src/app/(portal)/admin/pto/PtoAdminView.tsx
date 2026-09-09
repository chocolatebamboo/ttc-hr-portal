import TeamPtoCards from "@/components/TeamPtoCards";

/**
 * The standalone PTO Management admin page — same TeamPtoCards card list (Approve/Deny,
 * Pending/Upcoming) the dashboard's own Availability widget page now shows admins directly,
 * just with this page's own heading/description on top. Extracted to TeamPtoCards (Sept 2026)
 * so both places render one implementation, not two.
 */
export default function PtoAdminView() {
  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">PTO Management</h1>
      <p className="text-sm text-muted mb-4">
        Every team member&apos;s time-off requests, org-wide — not just one supervisor&apos;s team.
      </p>
      <TeamPtoCards />
    </div>
  );
}
