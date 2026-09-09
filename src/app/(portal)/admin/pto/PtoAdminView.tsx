import TeamPtoCards from "@/components/TeamPtoCards";

/**
 * The standalone PTO Management admin page — same TeamPtoCards card list (Approve/Deny/Undo,
 * Pending/Decided, inline chat) the dashboard's own Availability widget page now shows admins
 * directly, just with this page's own heading/description on top. Extracted to TeamPtoCards
 * (Sept 2026) so both places render one implementation, not two. `viewerId` is the signed-in
 * admin, passed down from page.tsx — see AvailabilityAdminView for why it's needed.
 */
export default function PtoAdminView({ viewerId }: { viewerId: string }) {
  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">PTO Management</h1>
      <p className="text-sm text-muted mb-4">
        Every team member&apos;s time-off requests, org-wide — not just one supervisor&apos;s team.
      </p>
      <TeamPtoCards viewerId={viewerId} />
    </div>
  );
}
