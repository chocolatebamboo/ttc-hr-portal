import TeamAvailabilityWeekPanel from "@/components/TeamAvailabilityWeekPanel";

/**
 * The standalone Team Availability admin page — same card list (Approve/Deny/Undo,
 * Pending/Decided, inline chat) the dashboard's own Availability widget page shows admins
 * directly, just with this page's own heading/description on top.
 *
 * `scope` (Oct 2026, opened to Supervisor — see canAccessTeamAvailability's own doc comment in
 * src/lib/authorization.ts): TeamAvailabilityWeekPanel/TeamAvailabilityCards already render
 * correctly scoped data either way (they fetch /api/admin/availability, and listAdminAvailability
 * narrows that for a non-admin caller — see that function's own doc comment); this prop only
 * drives the description copy below, same "all" vs "team" split AttendanceAdminView/PtoAdminView/
 * ReportsView already take from page.tsx.
 *
 * Oct 2026 (CB, pointing at the Availability page's own "Team availability requests" section:
 * "I'm still not seeing this view that I gave you the screenshot for the same way on Daijour...
 * the admin accounts need to have that functionality"): this page used to call
 * TeamAvailabilityCards directly with no bounds, which is also what made the earlier "archive
 * needs more structure" complaint true — everything decided ever just piled up underneath with
 * no way to navigate it. Swapped to TeamAvailabilityWeekPanel, the same `‹ Week of ___ › · This
 * week` nav Team Schedule and Attendance already use, and the exact component the Availability
 * page's own "Team availability requests" section is built on — so this page now matches that
 * screenshot instead of drifting into its own, older layout. `viewerId` is the signed-in
 * admin/supervisor, passed down from page.tsx (getCurrentEmployee runs server-side there) so the
 * inline chat thread knows which side of the conversation is "you."
 *
 * Round eighteen, correction (CB, Nov 2026, on a live screenshot: "it's supposed to show up fully
 * on the right-hand side, not just squished in there"): this used to wrap the heading AND
 * TeamAvailabilityWeekPanel together in one `max-w-3xl`, which meant TeamAvailabilityCards' own
 * master-detail grid never had more than that same ~768px to split a task's detail panel out of,
 * no matter the real page width. The heading/description keep their own `max-w-3xl` (same reading
 * width as always); TeamAvailabilityWeekPanel now sits outside it, free to use the page's full
 * available width — it still renders at its own identical narrow width day to day, since it
 * manages that itself and only drops it while a task is actually open (see that component's own
 * doc comment).
 */
export default function AvailabilityAdminView({ viewerId, scope }: { viewerId: string; scope: "all" | "team" }) {
  return (
    <>
      <div className="max-w-3xl">
        <h1 className="page-title text-2xl mb-1">Team Availability</h1>
        <p className="text-sm text-muted mb-4">
          {scope === "team"
            ? "Your own team's submitted availability. Purely informational: nothing here is enforced against scheduling."
            : "Every team member's submitted availability, org-wide — not just one supervisor's team. Purely informational: nothing here is enforced against scheduling."}
        </p>
      </div>
      <TeamAvailabilityWeekPanel viewerId={viewerId} />
    </>
  );
}
