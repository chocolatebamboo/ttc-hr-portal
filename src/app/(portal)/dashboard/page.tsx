import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { listDocumentsForEmployee } from "@/lib/documents";
import { listAnnouncementsForEmployee } from "@/lib/announcements";
import { getOnboardingAttention } from "@/lib/onboarding";
import { listMyAvailability, listAdminAvailability } from "@/lib/availability";
import { listTeamNoteTopicCounts, listAllTeamNoteTopicCounts } from "@/lib/team-notes";
import { listConversationSummaries } from "@/lib/direct-messages";
import TimeClockCard from "@/components/TimeClockCard";
import TimeOffSection from "@/components/TimeOffSection";
import AvailabilityStatusSection from "@/components/AvailabilityStatusSection";
import DateTasksSection from "@/components/DateTasksSection";
import QuickActionsCard from "@/components/QuickActionsCard";
import DashboardNotifications from "@/components/DashboardNotifications";
import { MegaphoneIcon, ChartIcon, ChatIcon, type IconProps } from "@/components/icons";
import { formatHoursCompact } from "@/lib/time";
import type { AnnouncementDTO, DocumentDTO } from "@/types";

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  // CB, Sept 2026: "on the administrator [side] that is approving, that should be a
  // notification... saying that this person wants to have that time approved. Once that
  // person approves it, then they would be able to see that on their main dashboard." Two
  // separate reads for two separate audiences — recentAvailability is every employee's own
  // submission history (mirrors recentPto below), pendingAvailabilityCount is HR-wide and
  // only ever fetched for an admin (listAdminAvailability itself throws ForbiddenError for
  // anyone else, same guard admin/availability/page.tsx already relies on).
  const recentAvailability = (await listMyAvailability(employee)).slice(0, 3);
  const pendingAvailabilityCount = isAdmin(employee)
    ? (await listAdminAvailability(employee)).pending.length
    : 0;

  // CB, Sept 2026: "on the receiving end... on the home page and on the availability page...
  // I send it to Sean, I don't see where Sean could see those messages" — a home-page signal
  // for BOTH directions that a per-date/per-request conversation has something waiting,
  // mirroring pendingAvailabilityCount's admin-only banner just above. `fromOthers` (not
  // `total`) is what a notification should count — messages the viewer didn't write
  // themselves — see TeamNoteTopicCountDTO's doc comment in src/types/index.ts for why this
  // isn't true unread tracking. Admins see it across every employee's conversations
  // (listAllTeamNoteTopicCounts, same org-wide reach as listAdminAvailability); everyone else
  // sees it for just their own. Extended this round for real peer-to-peer DMs (listConversationSummaries)
  // — the badge on the dashboard's message icon, and this banner, now cover every kind of
  // conversation the unified My Messages inbox lists, not just topic threads.
  const [teamNoteCounts, directConversations] = await Promise.all([
    isAdmin(employee) ? listAllTeamNoteTopicCounts(employee) : listTeamNoteTopicCounts(employee, employee.id),
    listConversationSummaries(employee),
  ]);
  const messagesFromOthers =
    teamNoteCounts.reduce((sum, c) => sum + c.fromOthers, 0) +
    directConversations.reduce((sum, c) => sum + c.fromOthers, 0);

  const documents = await listDocumentsForEmployee(employee);
  const pendingAcknowledgments = documents.filter((d) => d.requiresAcknowledgment && !d.acknowledgedAt);
  const onboardingAttention = await getOnboardingAttention(employee);
  const announcements = (await listAnnouncementsForEmployee(employee)).slice(0, 3);
  const [featuredAnnouncement, ...otherAnnouncements] = announcements;

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
            stay. */}
        <Link
          href="/messages"
          className="relative shrink-0 h-10 w-10 rounded-full bg-surface border border-border flex items-center justify-center hover:bg-black/[0.03] transition-colors"
          title="Messages"
        >
          <ChatIcon className="h-5 w-5 text-muted" />
          {messagesFromOthers > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
              style={{ background: "#8b5cf6" }}
            >
              {messagesFromOthers > 9 ? "9+" : messagesFromOthers}
            </span>
          )}
        </Link>
      </div>

      {/* Admin-only pending-approvals banner + everyone's messages banner — same one spot on
          both mobile and desktop (no md:hidden split like the sections below), right under the
          header so they're the first thing anyone sees on their home page, per CB's "on the
          administrator that is approving, that should be a notification... on their home page."
          Swipeable/dismissible (CB, Sept 2026: "the ability to exit... notifications") — see
          DashboardNotifications' own doc comment for how clearing and recovering works. */}
      <DashboardNotifications
        className="animate-in animate-in-2 mt-4"
        employeeId={employee.id}
        showApprovals={isAdmin(employee)}
        pendingApprovalsCount={pendingAvailabilityCount}
        messagesCount={messagesFromOthers}
      />

      {/* Mobile: bold color-block layout (CB's Sept 2026 aesthetic ask, reference screenshots
          in chat). Desktop keeps the original layout below, completely untouched — this pass
          was scoped to "mobile/app view" only. */}
      <div className="md:hidden mt-5 space-y-5">
        <div className="animate-in animate-in-2">
          <TimeClockCard variant="hero" />
        </div>

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
              under Needs your attention below). Everyone else keeps Docs to review as-is. */}
          {isAdmin(employee) ? (
            <StatCard label="Reports" icon={ChartIcon} tone="amber" href="/admin/reports" />
          ) : (
            <StatCard label="Docs to review" value={String(pendingAcknowledgments.length)} tone="amber" href="/documents" />
          )}
        </div>

        <div className="animate-in animate-in-4">
          <QuickActionsCard role={employee.role} initialKeys={employee.quickActionKeys} variant="mobile" />
        </div>

        <NeedsAttentionSection
          className="animate-in animate-in-4"
          onboardingAttention={onboardingAttention}
          pendingAcknowledgments={pendingAcknowledgments}
        />
        <DateTasksSection className="animate-in animate-in-4" employeeId={employee.id} />
        <AnnouncementsSection
          className="animate-in animate-in-5"
          featuredAnnouncement={featuredAnnouncement}
          otherAnnouncements={otherAnnouncements}
        />
        <TimeOffSection className="animate-in animate-in-5" recentPto={recentPto} />
        <AvailabilityStatusSection className="animate-in animate-in-5" recentAvailability={recentAvailability} />
      </div>

      {/* Desktop/tablet: unchanged from before this pass. */}
      <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="animate-in animate-in-2">
            <TimeClockCard />
          </div>

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
