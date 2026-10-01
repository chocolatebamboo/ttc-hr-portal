import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { canSeeAdminHomeDashboard, isAdmin } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { listDocumentsForEmployee } from "@/lib/documents";
import { listAnnouncementsForEmployee } from "@/lib/announcements";
import { getOnboardingAttention } from "@/lib/onboarding";
import { listMyAvailability, listAdminAvailability } from "@/lib/availability";
import { listAdminShifts } from "@/lib/shifts";
import { listCurrentlyClockedIn } from "@/lib/attendance-admin";
import { getDashboardNotificationsSummary } from "@/lib/dashboard-notifications";
import TimeClockCard from "@/components/TimeClockCard";
import AdminHomeHero from "@/components/AdminHomeHero";
import TeamScheduleGlance from "@/components/TeamScheduleGlance";
import ClockedInNowSection from "@/components/ClockedInNowSection";
import TimeOffSection from "@/components/TimeOffSection";
import AvailabilityStatusSection from "@/components/AvailabilityStatusSection";
import TeamAvailabilityRequestsSection from "@/components/TeamAvailabilityRequestsSection";
import DateTasksSection from "@/components/DateTasksSection";
import QuickActionsCard from "@/components/QuickActionsCard";
import DashboardNotifications, { MessagesBadgeLink } from "@/components/DashboardNotifications";
import { MegaphoneIcon, ChartIcon, type IconProps } from "@/components/icons";
import { formatHoursCompact, todayDateKey, dateKeyDaysFromNow } from "@/lib/time";
import type { AnnouncementDTO, DocumentDTO } from "@/types";

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  // CB, Sept 2026: "on the administrator [side] that is approving, that should be a
  // notification... saying that this person wants to have that time approved. Once that
  // person approves it, then they would be able to see that on their main dashboard." Every
  // employee's own submission history (mirrors recentPto below) — unrelated to the admin-only
  // pending-approvals banner, which now lives entirely behind notificationsSummary below.
  const recentAvailability = (await listMyAvailability(employee)).slice(0, 3);

  // Correction brief (Sept 2026, "Correction & Refinement Brief" #1): "genuinely unread
  // messages," server-persisted dismissal, no manual refresh needed. One shared summary for
  // both the header's Messages badge (MessagesBadgeLink) and the pending-approvals/messages
  // banners (DashboardNotifications) below — see src/lib/dashboard-notifications.ts for the
  // real unread-count math and getDashboardNotificationsSummary's own comment for why this is
  // computed once, server-side, as the client polling components' starting point.
  const notificationsSummary = await getDashboardNotificationsSummary(employee);

  const documents = await listDocumentsForEmployee(employee);
  const pendingAcknowledgments = documents.filter((d) => d.requiresAcknowledgment && !d.acknowledgedAt);
  const onboardingAttention = await getOnboardingAttention(employee);
  const announcements = (await listAnnouncementsForEmployee(employee)).slice(0, 3);
  const [featuredAnnouncement, ...otherAnnouncements] = announcements;

  // CB, Sept 2026 (redesign follow-up): "I want [team availability requests] to be like where
  // the announcements are... for the admin, that would be covering schedules and stuff like
  // that." Same admin-only pending queue TeamAvailabilityCards shows in full on /availability
  // (heading there renamed to match — "Team availability requests"), just the compact summary
  // for this Home sidebar slot — see TeamAvailabilityRequestsSection's own doc comment for why
  // this stays a read-only list rather than the full interactive card. Anyone who isn't an admin
  // or Daijour's own SUPERVISOR role never calls listAdminAvailability at all (it throws
  // ForbiddenError otherwise) — canSeeAdminHomeDashboard gates the fetch itself, not just the
  // render; listAdminAvailability itself narrows to just the caller's own reports when they're a
  // Supervisor rather than an admin (see its own doc comment).
  const pendingTeamAvailability = canSeeAdminHomeDashboard(employee)
    ? (await listAdminAvailability(employee)).pending
    : [];

  // CB, Sept 2026 (admin Home redesign): "I should see a dashboard of pretty much all the
  // different people that have the schedule right now... just so I could get like a glance of
  // who is supposed to be working right now." Every shift for TODAY, org-wide — feeds both
  // AdminHomeHero's "Scheduled today"/"In progress" stats and TeamScheduleGlance's list below.
  // Same canSeeAdminHomeDashboard-gates-the-fetch pattern as pendingTeamAvailability just above;
  // listAdminShifts itself already narrows to the caller's own reports for a Supervisor actor
  // (its own employeeFilter.supervisorId, src/lib/shifts.ts) — org-wide for an admin, unchanged.
  const todayKey = todayDateKey();
  const todaysShifts = canSeeAdminHomeDashboard(employee)
    ? await listAdminShifts(employee, { dateFrom: todayKey, dateTo: todayKey })
    : [];
  const scheduledTodayCount = todaysShifts.length;
  const inProgressCount = todaysShifts.filter((s) => s.displayStatus === "IN_PROGRESS").length;

  // CB, Sept 2026 (follow-up to the above): "just because somebody isn't working today, I
  // should be able to see the upcoming schedules, cleanly." Every future shift from tomorrow
  // onward, grouped by date in TeamScheduleGlance, so the glance is never a dead end just
  // because today happens to be quiet, shown whether or not today itself has anyone scheduled.
  // Deliberately no dateTo cap here (an earlier version capped this at 6 days out and CB found
  // it empty because the one shift on the books at the time was 12 days out): listAdminShifts's
  // dateTo is optional, and a small team like TTC's doesn't schedule far enough ahead for an
  // unbounded list to get unwieldy, unlike the exhaustive Team Schedule page this still links
  // out to. CANCELLED/REASSIGNED are filtered out here (not something listAdminShifts itself
  // does) since a cancelled or reassigned-away shift isn't really "upcoming" for the person it
  // used to belong to; every other status for a future date is still deriveShiftDisplayStatus's
  // plain "UPCOMING" or an in-review change/cancellation request, both still worth showing.
  const upcomingShiftsRaw = canSeeAdminHomeDashboard(employee)
    ? await listAdminShifts(employee, { dateFrom: dateKeyDaysFromNow(1) })
    : [];
  const upcomingShifts = upcomingShiftsRaw.filter(
    (s) => s.displayStatus !== "CANCELLED" && s.displayStatus !== "REASSIGNED"
  );

  // CB, Oct 2026: "were supposed to see the clock running when the team clocks in, that is
  // very important" — a real clock-punch view (every open TimeSession right now), distinct from
  // the schedule-derived "In progress" stat/TeamScheduleGlance above, which only reflects who's
  // SCHEDULED to be working, not who's actually clocked in. Same canSeeAdminHomeDashboard-gates-
  // the-fetch pattern as pendingTeamAvailability/todaysShifts above; listCurrentlyClockedIn
  // itself narrows to the caller's own reports for a Supervisor actor, org-wide for an admin.
  const currentlyClockedIn = canSeeAdminHomeDashboard(employee) ? await listCurrentlyClockedIn(employee) : [];

  // One transaction, four reads: recent PTO history (existing), plus the numbers the mobile
  // stat row needs (Sept 2026 aesthetic pass) that nothing on this page fetched before.
  // "This week" is a rolling last-7-days window, not a calendar week — TTC has no fixed
  // schedules (see clockout-reminders.ts's doc comment), so there's no natural Mon-Sun
  // boundary to anchor to; a rolling window needs no such boundary.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  sevenDaysAgo.setUTCHours(0, 0, 0, 0);

  const { recentPto, weekMinutes, pendingPtoCount, pendingMyAvailabilityCount } = await withRlsContext(
    { employeeId: employee.id, role: employee.role },
    async (tx) => {
      const [recentPto, weekAgg, pendingPtoCount, pendingMyAvailabilityCount] = await Promise.all([
        tx.ptoRequest.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: "desc" }, take: 3 }),
        tx.timeEntry.aggregate({
          where: { employeeId: employee.id, workDate: { gte: sevenDaysAgo } },
          _sum: { totalMinutes: true },
        }),
        tx.ptoRequest.count({ where: { employeeId: employee.id, status: "PENDING" } }),
        // CB, Sept 2026: "I'm not sure if pending PTO and availability... maybe we could
        // combine them... it'd be, like, availability" — the pink stat tile below now reads
        // one combined "pending" count across both, rather than PTO alone.
        tx.availabilitySubmission.count({ where: { employeeId: employee.id, status: "PENDING" } }),
      ]);
      return { recentPto, weekMinutes: weekAgg._sum.totalMinutes ?? 0, pendingPtoCount, pendingMyAvailabilityCount };
    }
  );

  return (
    <div className="max-w-5xl">
      <div className="animate-in flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title text-2xl md:text-3xl">
            Welcome, {employee.preferredName || employee.firstName}
          </h1>
          <p className="text-sm text-muted mt-0.5">{employee.jobTitle}</p>
        </div>
        {/* CB, Sept 2026: "an icon on the home dashboard to kinda signify that we got a
            message... similar to where we could see all the different messages for its
            respective day" — a quick-glance shortcut into the new /messages inbox, kept
            alongside (not instead of) MessagesBanner below per her own confirmation both should
            stay. Now a live-polling client component (see DashboardNotifications.tsx) instead of
            a static badge fixed to whatever the count was at the last full page load. */}
        <MessagesBadgeLink initial={notificationsSummary} />
      </div>

      {/* Admin-only pending-approvals banner + everyone's messages banner — same one spot on
          both mobile and desktop (no md:hidden split like the sections below), right under the
          header so they're the first thing anyone sees on their home page, per CB's "on the
          administrator that is approving, that should be a notification... on their home page."
          Swipeable/dismissible (CB, Sept 2026: "the ability to exit... notifications") — see
          DashboardNotifications' own doc comment for how clearing and real server-side
          dismissal now works. */}
      <DashboardNotifications className="animate-in animate-in-2 mt-4" initial={notificationsSummary} />

      {/* Mobile: bold color-block layout (CB's Sept 2026 aesthetic ask, reference screenshots
          in chat). Desktop keeps the original layout below, completely untouched — this pass
          was scoped to "mobile/app view" only. */}
      <div className="md:hidden mt-5 space-y-5">
        {/* Oct 2026 (CB: "the announcement should always be at the top"): moved from its old
            spot near the bottom (after Team availability requests, before Time Off) to the very
            first thing in the mobile scroll — ahead of the clock-in hero itself. Still exactly
            the same AnnouncementsSection component/data as before (featuredAnnouncement/
            otherAnnouncements, both already computed above from listAnnouncementsForEmployee),
            just rendered in a different spot; "but should not be there forever" is a separate,
            still-open ask about default expiration, not a layout change. */}
        <AnnouncementsSection
          className="animate-in animate-in-1"
          featuredAnnouncement={featuredAnnouncement}
          otherAnnouncements={otherAnnouncements}
        />

        <div className="animate-in animate-in-2">
          {canSeeAdminHomeDashboard(employee) ? (
            <AdminHomeHero
              variant="hero"
              scheduledToday={scheduledTodayCount}
              inProgress={inProgressCount}
              clocksIn={employee.clocksIn}
            />
          ) : (
            <TimeClockCard variant="hero" clocksIn={employee.clocksIn} />
          )}
        </div>

        {canSeeAdminHomeDashboard(employee) && (
          <div className="animate-in animate-in-2">
            <TeamScheduleGlance shifts={todaysShifts} upcomingShifts={upcomingShifts} />
          </div>
        )}

        {canSeeAdminHomeDashboard(employee) && (
          <div className="animate-in animate-in-2">
            <ClockedInNowSection initial={currentlyClockedIn} />
          </div>
        )}

        {/* Oct 2026 (CB, circling this exact row on a screenshot of her own admin dashboard):
            "I don't think it's necessary" for an admin account specifically — SUPER_ADMIN/
            HR_ADMIN no longer see this row at all on mobile. Deliberately isAdmin(employee), not
            canSeeAdminHomeDashboard: CB drew the line at "only the admin accounts," and Daijour
            (SUPERVISOR) still has real work tied to his own "This week"/"Availability" numbers
            (he clocks in and submits his own availability like any team member) — he keeps the
            row exactly as before, same as a regular employee. */}
        {!isAdmin(employee) && (
          <div className="animate-in animate-in-3 grid grid-cols-3 gap-3">
            <StatCard label="This week" value={formatHoursCompact(weekMinutes)} tone="blue" href="/dashboard/week" />
            <StatCard
              label="Availability"
              value={String(pendingPtoCount + pendingMyAvailabilityCount)}
              tone="pink"
              href="/dashboard/availability"
            />
            {/* CB, Sept 2026: "for admins, I want that to be replaced... switch them out for
                reports... keep it yellow" — an admin's yellow tile becomes a straight tap-through
                to Reports instead of their own doc acknowledgments (still visible either way,
                under Needs your attention below). Daijour (SUPERVISOR) already has real Reports
                access (canAccessReports, src/lib/authorization.ts) via Correction brief #8, so he
                gets this tile too now rather than Docs to review, same as any admin. Everyone else
                keeps Docs to review as-is. Admin itself never reaches this branch any more — the
                whole row is hidden for isAdmin(employee) above — but the canSeeAdminHomeDashboard
                check stays here unchanged since Daijour (SUPERVISOR) still needs it. */}
            {canSeeAdminHomeDashboard(employee) ? (
              <StatCard label="Reports" icon={ChartIcon} tone="amber" href="/admin/reports" />
            ) : (
              <StatCard label="Docs to review" value={String(pendingAcknowledgments.length)} tone="amber" href="/documents" />
            )}
          </div>
        )}

        <div className="animate-in animate-in-4">
          <QuickActionsCard role={employee.role} initialKeys={employee.quickActionKeys} variant="mobile" />
        </div>

        <NeedsAttentionSection
          className="animate-in animate-in-4"
          onboardingAttention={onboardingAttention}
          pendingAcknowledgments={pendingAcknowledgments}
        />
        <DateTasksSection className="animate-in animate-in-4" employeeId={employee.id} />
        <TeamAvailabilityRequestsSection
          className="animate-in animate-in-4"
          initialPending={pendingTeamAvailability}
          viewerId={employee.id}
        />
        <TimeOffSection className="animate-in animate-in-5" recentPto={recentPto} />
        <AvailabilityStatusSection className="animate-in animate-in-5" recentAvailability={recentAvailability} />
      </div>

      {/* Desktop/tablet: unchanged from before this pass. */}
      <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="animate-in animate-in-2">
            {canSeeAdminHomeDashboard(employee) ? (
              <AdminHomeHero
                variant="default"
                scheduledToday={scheduledTodayCount}
                inProgress={inProgressCount}
                clocksIn={employee.clocksIn}
              />
            ) : (
              <TimeClockCard clocksIn={employee.clocksIn} />
            )}
          </div>

          {canSeeAdminHomeDashboard(employee) && (
            <div className="animate-in animate-in-2">
              <TeamScheduleGlance shifts={todaysShifts} upcomingShifts={upcomingShifts} />
            </div>
          )}

          {canSeeAdminHomeDashboard(employee) && (
            <div className="animate-in animate-in-2">
              <ClockedInNowSection initial={currentlyClockedIn} />
            </div>
          )}

          <div className="animate-in animate-in-3">
            <QuickActionsCard role={employee.role} initialKeys={employee.quickActionKeys} variant="desktop" />
          </div>

          <TimeOffSection className="animate-in animate-in-4" recentPto={recentPto} />
          <AvailabilityStatusSection className="animate-in animate-in-4" recentAvailability={recentAvailability} />
        </div>

        <div className="space-y-5">
          <NeedsAttentionSection
            className="animate-in animate-in-2"
            onboardingAttention={onboardingAttention}
            pendingAcknowledgments={pendingAcknowledgments}
          />
          <DateTasksSection className="animate-in animate-in-2" employeeId={employee.id} />
          <TeamAvailabilityRequestsSection
            className="animate-in animate-in-3"
            initialPending={pendingTeamAvailability}
            viewerId={employee.id}
          />
          <AnnouncementsSection
            className="animate-in animate-in-3"
            featuredAnnouncement={featuredAnnouncement}
            otherAnnouncements={otherAnnouncements}
          />
        </div>
      </div>
    </div>
  );
}

// CB, Sept 2026: these tiles should be tappable straight through to whatever they're
// summarizing — "This week" to its own widget breakdown, "Availability" (Pending PTO +
// availability combined) to its own widget page, "Docs to review"/"Reports" to Documents or
// Reports — rather than sitting there as plain readouts with nowhere to go.
// transition-transform + active:scale gives the same tap feedback Quick Actions already has,
// so tapping a stat tile feels like the same kind of control, not a different one.
//
// `icon` is the admin "Reports" tile's escape hatch: Reports has no natural pending-count
// number to headline (it's a generate-on-demand report, not a queue), so that tile shows its
// Quick Actions icon at the same visual weight the other tiles give their number instead of a
// number that would be either fake or misleading.
function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value?: string;
  icon?: (props: IconProps) => React.ReactElement;
  tone: "blue" | "pink" | "amber";
  href: string;
}) {
  const TONE: Record<string, string> = {
    blue: "text-white",
    pink: "text-white",
    amber: "bg-amber-400 text-amber-950",
  };
  const style =
    tone === "blue"
      ? { background: "var(--ttc-blue)" }
      : tone === "pink"
        ? { background: "var(--ttc-pink)" }
        : undefined;
  return (
    <Link
      href={href}
      className={`block rounded-2xl p-4 transition-transform active:scale-95 ${TONE[tone]}`}
      style={style}
    >
      {Icon ? (
        <Icon className="h-6 w-6" />
      ) : (
        <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
      )}
      <p className="text-[11px] font-medium mt-1.5 opacity-90 leading-tight">{label}</p>
    </Link>
  );
}

function NeedsAttentionSection({
  className,
  onboardingAttention,
  pendingAcknowledgments,
}: {
  className?: string;
  onboardingAttention: Awaited<ReturnType<typeof getOnboardingAttention>>;
  pendingAcknowledgments: DocumentDTO[];
}) {
  if (!onboardingAttention.needsAttention && pendingAcknowledgments.length === 0) return null;
  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Needs your attention</h2>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {onboardingAttention.needsAttention && (
          <Link
            href="/onboarding"
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
          >
            <span className="truncate">{onboardingAttention.label}</span>
            <span className="text-accent-ink font-medium whitespace-nowrap shrink-0">Review →</span>
          </Link>
        )}
        {pendingAcknowledgments.map((doc) => (
          <Link
            key={doc.id}
            href="/documents"
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
          >
            <span className="truncate">{doc.title}</span>
            <span className="text-accent-ink font-medium whitespace-nowrap shrink-0">Review →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function AnnouncementsSection({
  className,
  featuredAnnouncement,
  otherAnnouncements,
}: {
  className?: string;
  featuredAnnouncement: AnnouncementDTO | undefined;
  otherAnnouncements: AnnouncementDTO[];
}) {
  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Announcements</h2>
      {!featuredAnnouncement ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          No announcements right now.
        </div>
      ) : (
        <div className="space-y-2.5">
          <Link
            href="/announcements"
            className="block rounded-2xl p-4 text-white transition-transform hover:-translate-y-0.5"
            style={{ background: "linear-gradient(135deg, var(--ttc-pink-ink), var(--ttc-pink))" }}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-white/80 mb-1.5">
              <MegaphoneIcon className="h-3.5 w-3.5" />
              {formatAnnouncementDate(featuredAnnouncement.publishDate)}
            </div>
            <p className="font-semibold text-sm mb-1">{featuredAnnouncement.title}</p>
            <p className="text-xs text-white/85 line-clamp-2">{featuredAnnouncement.message}</p>
          </Link>
          {otherAnnouncements.length > 0 && (
            <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
              {otherAnnouncements.map((a) => (
                <Link
                  key={a.id}
                  href="/announcements"
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
                >
                  <span className="truncate">{a.title}</span>
                  <span className="text-muted text-xs whitespace-nowrap shrink-0">
                    {formatAnnouncementDate(a.publishDate)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// PendingApprovalsBanner and MessagesBanner now live in src/components/DashboardNotifications.tsx
// (Sept 2026) so they can be wrapped in swipe-to-clear — see that file's own doc comment.
