import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { listDocumentsForEmployee } from "@/lib/documents";
import { listAnnouncementsForEmployee } from "@/lib/announcements";
import { getOnboardingAttention } from "@/lib/onboarding";
import { listMyAvailability, listAdminAvailability } from "@/lib/availability";
import { formatSlotDate } from "@/lib/availability-format";
import TimeClockCard from "@/components/TimeClockCard";
import PtoStatusPill from "@/components/PtoStatusPill";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { CalendarIcon, FolderIcon, ChecklistIcon, MegaphoneIcon, ChartIcon, BellIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange, formatHoursCompact } from "@/lib/time";
import type { AnnouncementDTO, AvailabilityDTO, AvailabilitySlot, DocumentDTO, PtoStatus, PtoType } from "@/types";

/** recentPto is read straight off Prisma (tx.ptoRequest.findMany below), not converted to a
 *  DTO — it never leaves the server, so the extra round-trip through a string-dates shape
 *  buys nothing. This is that raw row's shape, just narrowed to the fields TimeOffSection
 *  actually reads. */
type RecentPtoRow = { id: string; type: PtoType; status: PtoStatus; startDate: Date; endDate: Date };

// CB, Sept 2026: "I want you to remove the quick action my time because we already have my
// time within the mobile view" — My Time is now reachable directly from BottomNav on mobile
// (and from the sidebar on desktop, same as it always was there too), so it came out of this
// list entirely rather than just on mobile. Availability and Reports were added earlier the
// same session. Reports has no employee-facing view (see admin/reports/page.tsx's own
// redirect) so it's appended only for admins — see quickActions below — instead of living in
// this shared base list everyone gets.
const QUICK_ACTIONS = [
  { label: "Availability", href: "/availability", icon: CalendarIcon, tone: "pink" as const },
  { label: "View Documents", href: "/documents", icon: FolderIcon, tone: "amber" as const },
  { label: "View Onboarding", href: "/onboarding", icon: ChecklistIcon, tone: "emerald" as const },
];

const ADMIN_QUICK_ACTION = { label: "Reports", href: "/admin/reports", icon: ChartIcon, tone: "violet" as const };

const CHIP_TONE: Record<string, string> = {
  blue: "bg-[color-mix(in_srgb,var(--ttc-blue)_12%,white)] text-[var(--ttc-blue-ink)]",
  pink: "bg-[color-mix(in_srgb,var(--ttc-pink)_12%,white)] text-[var(--ttc-pink-ink)]",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
  violet: "bg-violet-100 text-violet-800",
};

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Thu, Sep 17" for a single-date submission, "Thu, Sep 17 +2 more" for a multi-date one —
 *  compact enough for one line next to a status pill (AvailabilityStatusSection below), same
 *  spirit as TimeOffSection's PTO_TYPE_LABEL + formatDateRange pairing just without a fixed
 *  end date to range against, since a submission's dates aren't necessarily consecutive
 *  (see AvailabilitySlot's doc comment in src/types/index.ts). */
function summarizeSlots(slots: AvailabilitySlot[]): string {
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
  const first = formatSlotDate(sorted[0].date);
  return sorted.length === 1 ? first : `${first} +${sorted.length - 1} more`;
}

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const quickActions = isAdmin(employee) ? [...QUICK_ACTIONS, ADMIN_QUICK_ACTION] : QUICK_ACTIONS;

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

  const documents = await listDocumentsForEmployee(employee);
  const pendingAcknowledgments = documents.filter((d) => d.requiresAcknowledgment && !d.acknowledgedAt);
  const onboardingAttention = await getOnboardingAttention(employee);
  const announcements = (await listAnnouncementsForEmployee(employee)).slice(0, 3);
  const [featuredAnnouncement, ...otherAnnouncements] = announcements;

  // One transaction, three reads: recent PTO history (existing), plus two numbers the
  // mobile stat row needs (Sept 2026 aesthetic pass) that nothing on this page fetched
  // before. "This week" is a rolling last-7-days window, not a calendar week — TTC has no
  // fixed schedules (see clockout-reminders.ts's doc comment), so there's no natural
  // Mon-Sun boundary to anchor to; a rolling window needs no such boundary.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  sevenDaysAgo.setUTCHours(0, 0, 0, 0);

  const { recentPto, weekMinutes, pendingPtoCount } = await withRlsContext(
    { employeeId: employee.id, role: employee.role },
    async (tx) => {
      const [recentPto, weekAgg, pendingPtoCount] = await Promise.all([
        tx.ptoRequest.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: "desc" }, take: 3 }),
        tx.timeEntry.aggregate({
          where: { employeeId: employee.id, workDate: { gte: sevenDaysAgo } },
          _sum: { totalMinutes: true },
        }),
        tx.ptoRequest.count({ where: { employeeId: employee.id, status: "PENDING" } }),
      ]);
      return { recentPto, weekMinutes: weekAgg._sum.totalMinutes ?? 0, pendingPtoCount };
    }
  );

  return (
    <div className="max-w-5xl">
      <div className="animate-in">
        <h1 className="page-title text-2xl md:text-3xl">
          Welcome, {employee.preferredName || employee.firstName}
        </h1>
        <p className="text-sm text-muted mt-0.5">{employee.jobTitle}</p>
      </div>

      {/* Admin-only "notification" that a team member is waiting on a decision — same one
          banner on both mobile and desktop (no md:hidden split like the sections below), right
          under the header so it's the first thing an admin sees on their home page, per CB's
          "on the administrator that is approving, that should be a notification... on their
          home page." */}
      {isAdmin(employee) && pendingAvailabilityCount > 0 && (
        <PendingApprovalsBanner className="animate-in animate-in-2 mt-4" count={pendingAvailabilityCount} />
      )}

      {/* Mobile: bold color-block layout (CB's Sept 2026 aesthetic ask, reference screenshots
          in chat). Desktop keeps the original layout below, completely untouched — this pass
          was scoped to "mobile/app view" only. */}
      <div className="md:hidden mt-5 space-y-5">
        <div className="animate-in animate-in-2">
          <TimeClockCard variant="hero" />
        </div>

        <div className="animate-in animate-in-3 grid grid-cols-3 gap-3">
          <StatCard label="This week" value={formatHoursCompact(weekMinutes)} tone="blue" href="/time" />
          <StatCard label="Pending PTO" value={String(pendingPtoCount)} tone="pink" href="/time" />
          <StatCard label="Docs to review" value={String(pendingAcknowledgments.length)} tone="amber" href="/documents" />
        </div>

        <div className="animate-in animate-in-4">
          <div className="bg-surface border border-border rounded-2xl p-5">
            <h2 className="text-sm font-medium text-muted mb-3">Quick actions</h2>
            <div className="grid grid-cols-4 gap-2">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="flex flex-col items-center text-center gap-2 rounded-xl px-1 py-3 text-muted hover:bg-black/[0.03] transition-colors"
                >
                  <span
                    className={`h-10 w-10 rounded-full flex items-center justify-center ${CHIP_TONE[action.tone]}`}
                  >
                    <action.icon className="h-5 w-5" />
                  </span>
                  <span className="text-[11px] font-medium leading-tight text-foreground">{action.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <NeedsAttentionSection
          className="animate-in animate-in-4"
          onboardingAttention={onboardingAttention}
          pendingAcknowledgments={pendingAcknowledgments}
        />
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
            <div className="bg-surface border border-border rounded-2xl p-5">
              <h2 className="text-sm font-medium text-muted mb-3">Quick actions</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {quickActions.map((action) => (
                  <Link
                    key={action.href + action.label}
                    href={action.href}
                    className="flex flex-col items-center text-center gap-2 rounded-xl px-3 py-4 text-muted hover:bg-black/[0.03] hover:text-foreground transition-colors"
                  >
                    <action.icon className="h-5 w-5" />
                    <span className="text-xs font-medium leading-tight text-foreground">{action.label}</span>
                  </Link>
                ))}
              </div>
            </div>
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

// CB, Sept 2026: these three tiles should be tappable straight through to whatever they're
// summarizing — "This week" and "Pending PTO" to My Time (hours and PTO both live there),
// "Docs to review" to Documents — rather than sitting there as plain readouts with nowhere to
// go. transition-transform + active:scale gives the same tap feedback Quick Actions already
// has, so tapping a stat tile feels like the same kind of control, not a different one.
function StatCard({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string;
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
      <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
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

function TimeOffSection({
  className,
  recentPto,
}: {
  className?: string;
  recentPto: RecentPtoRow[];
}) {
  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Time off</h2>
      {recentPto.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          No time-off requests yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {recentPto.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3">
              <p className="text-sm">
                {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate.toISOString(), r.endDate.toISOString())}
              </p>
              <PtoStatusPill status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// CB, Sept 2026: the employee-facing half of the availability notification — always visible
// once there's history, same "Time off" pattern above rather than something that has to be
// dismissed, so an approval or denial is just sitting there on the dashboard next time the
// team member looks, no separate unread state to track. Reuses AvailabilityStatusPill (already
// used on /availability and admin/availability) rather than PtoStatusPill even though the two
// status enums share the same four values — this section is specifically about availability,
// and "Pending approval" (AvailabilityStatusPill's own PENDING label) reads better here than
// PtoStatusPill's bare "Pending".
function AvailabilityStatusSection({
  className,
  recentAvailability,
}: {
  className?: string;
  recentAvailability: AvailabilityDTO[];
}) {
  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-muted mb-2">Availability</h2>
      {recentAvailability.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          No availability submitted yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {recentAvailability.map((a) => (
            <Link
              key={a.id}
              href="/availability"
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
            >
              <span className="truncate">{summarizeSlots(a.slots)}</span>
              <AvailabilityStatusPill status={a.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// CB, Sept 2026: the admin-facing half — "on the administrator that is approving, that should
// be a notification... on their home page saying that this person wants to have that time
// approved." Only rendered when there's actually something pending (see the isAdmin +
// pendingAvailabilityCount > 0 guard in DashboardPage above), so it disappears on its own the
// moment the queue is empty rather than needing to be dismissed — same "shows while true"
// shape NeedsAttentionSection already uses for onboarding/document items.
function PendingApprovalsBanner({ className, count }: { className?: string; count: number }) {
  return (
    <Link
      href="/admin/availability"
      className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-white transition-transform hover:-translate-y-0.5 ${className ?? ""}`}
      style={{ background: "linear-gradient(135deg, var(--ttc-blue-ink), var(--ttc-blue))" }}
    >
      <span className="h-9 w-9 shrink-0 rounded-full bg-white/15 flex items-center justify-center">
        <BellIcon className="h-4.5 w-4.5" />
      </span>
      <p className="text-sm font-medium">
        {count} availability {count === 1 ? "request" : "requests"} waiting for your review
      </p>
      <span className="ml-auto text-xs font-medium whitespace-nowrap shrink-0 opacity-90">Review →</span>
    </Link>
  );
}
