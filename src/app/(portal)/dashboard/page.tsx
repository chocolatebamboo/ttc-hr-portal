import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { listDocumentsForEmployee } from "@/lib/documents";
import { listAnnouncementsForEmployee } from "@/lib/announcements";
import { getOnboardingAttention } from "@/lib/onboarding";
import TimeClockCard from "@/components/TimeClockCard";
import PtoStatusPill from "@/components/PtoStatusPill";
import { ClockIcon, CalendarIcon, FolderIcon, ChecklistIcon, MegaphoneIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange, formatHoursCompact } from "@/lib/time";
import type { AnnouncementDTO, DocumentDTO, PtoStatus, PtoType } from "@/types";

/** recentPto is read straight off Prisma (tx.ptoRequest.findMany below), not converted to a
 *  DTO — it never leaves the server, so the extra round-trip through a string-dates shape
 *  buys nothing. This is that raw row's shape, just narrowed to the fields TimeOffSection
 *  actually reads. */
type RecentPtoRow = { id: string; type: PtoType; status: PtoStatus; startDate: Date; endDate: Date };

const QUICK_ACTIONS = [
  { label: "Request Time Off", href: "/time", icon: CalendarIcon, tone: "blue" as const },
  { label: "View Timesheet", href: "/time", icon: ClockIcon, tone: "pink" as const },
  { label: "View Documents", href: "/documents", icon: FolderIcon, tone: "amber" as const },
  { label: "View Onboarding", href: "/onboarding", icon: ChecklistIcon, tone: "emerald" as const },
];

const CHIP_TONE: Record<string, string> = {
  blue: "bg-[color-mix(in_srgb,var(--ttc-blue)_12%,white)] text-[var(--ttc-blue-ink)]",
  pink: "bg-[color-mix(in_srgb,var(--ttc-pink)_12%,white)] text-[var(--ttc-pink-ink)]",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
};

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

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

      {/* Mobile: bold color-block layout (CB's Sept 2026 aesthetic ask, reference screenshots
          in chat). Desktop keeps the original layout below, completely untouched — this pass
          was scoped to "mobile/app view" only. */}
      <div className="md:hidden mt-5 space-y-5">
        <div className="animate-in animate-in-2">
          <TimeClockCard variant="hero" />
        </div>

        <div className="animate-in animate-in-3 grid grid-cols-3 gap-3">
          <StatCard label="This week" value={formatHoursCompact(weekMinutes)} tone="blue" />
          <StatCard label="Pending PTO" value={String(pendingPtoCount)} tone="pink" />
          <StatCard label="Docs to review" value={String(pendingAcknowledgments.length)} tone="amber" />
        </div>

        <div className="animate-in animate-in-4">
          <div className="bg-surface border border-border rounded-2xl p-5">
            <h2 className="text-sm font-medium text-muted mb-3">Quick actions</h2>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_ACTIONS.map((action) => (
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
                {QUICK_ACTIONS.map((action) => (
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

function StatCard({ label, value, tone }: { label: string; value: string; tone: "blue" | "pink" | "amber" }) {
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
    <div className={`rounded-2xl p-4 ${TONE[tone]}`} style={style}>
      <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
      <p className="text-[11px] font-medium mt-1.5 opacity-90 leading-tight">{label}</p>
    </div>
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
