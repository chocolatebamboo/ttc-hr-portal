import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { listDocumentsForEmployee } from "@/lib/documents";
import TimeClockCard from "@/components/TimeClockCard";
import PtoStatusPill from "@/components/PtoStatusPill";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";

const QUICK_ACTIONS = [
  { label: "Request Time Off", href: "/time-off" },
  { label: "View Timesheet", href: "/time" },
  { label: "View Documents", href: "/documents" },
  { label: "View Onboarding", href: "/onboarding" },
];

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

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title text-2xl md:text-3xl">
          Welcome, {employee.preferredName || employee.firstName}
        </h1>
        <p className="text-sm text-muted mt-0.5">{employee.jobTitle}</p>
      </div>

      <TimeClockCard />

      <div>
        <h2 className="text-sm font-medium text-muted mb-2">Quick actions</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-medium hover:border-accent hover:text-accent-ink transition-colors"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div>
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

      <div>
        <h2 className="text-sm font-medium text-muted mb-2">Documents awaiting your acknowledgment</h2>
        {pendingAcknowledgments.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
            You&apos;re all caught up — nothing needs your acknowledgment right now.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
            {pendingAcknowledgments.map((doc) => (
              <Link
                key={doc.id}
                href="/documents"
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-black/[0.02] transition-colors"
              >
                <span>{doc.title}</span>
                <span className="text-accent-ink font-medium whitespace-nowrap">Review →</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted mb-2">Announcements</h2>
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          No announcements yet — this module hasn&apos;t been built.
        </div>
      </div>
    </div>
  );
}
