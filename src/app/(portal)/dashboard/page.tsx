import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { listDocumentsForEmployee } from "@/lib/documents";
import { listAnnouncementsForEmployee } from "@/lib/announcements";
import TimeClockCard from "@/components/TimeClockCard";
import PtoStatusPill from "@/components/PtoStatusPill";
import { ClockIcon, CalendarIcon, FolderIcon, ChecklistIcon, MegaphoneIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";

const QUICK_ACTIONS = [
  { label: "Request Time Off", href: "/time-off", icon: CalendarIcon },
  { label: "View Timesheet", href: "/time", icon: ClockIcon },
  { label: "View Documents", href: "/documents", icon: FolderIcon },
  { label: "View Onboarding", href: "/onboarding", icon: ChecklistIcon },
];

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const recentPto = await withRlsContext({ employeeId: employee.id, role: employee.role }, (tx) =>
    tx.ptoRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 3,
    })
  );

  const documents = await listDocumentsForEmployee(employee);
  const pendingAcknowledgments = documents.filter((d) => d.requiresAcknowledgment && !d.acknowledgedAt);
  const announcements = (await listAnnouncementsForEmployee(employee)).slice(0, 3);
  const [featuredAnnouncement, ...otherAnnouncements] = announcements;

  return (
    <div className="max-w-5xl">
      <div className="animate-in">
        <h1 className="page-title text-2xl md:text-3xl">
          Welcome, {employee.preferredName || employee.firstName}
        </h1>
        <p className="text-sm text-muted mt-0.5">{employee.jobTitle}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        {/* Main column: today's clock, quick actions, time off history. */}
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
                    key={action.href}
                    href={action.href}
                    className="group flex flex-col items-center text-center gap-2 rounded-xl px-3 py-4 hover:bg-black/[0.03] transition-colors"
                  >
                    <span className="section-icon-chip h-10 w-10 group-hover:bg-accent-ink/15 transition-colors">
                      <action.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="text-xs font-medium leading-tight">{action.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="animate-in animate-in-4">
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
        </div>

        {/* Side column: what needs attention, then what's new. */}
        <div className="space-y-5">
          {pendingAcknowledgments.length > 0 && (
            <div className="animate-in animate-in-2">
              <h2 className="text-sm font-medium text-muted mb-2">Needs your attention</h2>
              <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
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
          )}

          <div className="animate-in animate-in-3">
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
        </div>
      </div>
    </div>
  );
}
