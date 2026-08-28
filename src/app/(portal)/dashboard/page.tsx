import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import TimeClockCard from "@/components/TimeClockCard";

const QUICK_ACTIONS = [
  { label: "Request Time Off", href: "/time-off" },
  { label: "View Timesheet", href: "/time" },
  { label: "View Documents", href: "/documents" },
  { label: "View Onboarding", href: "/onboarding" },
];

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
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
              className="rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-medium hover:border-brand transition-colors"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted mb-2">Time off</h2>
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          Time-off requests aren&apos;t built yet — this card will show your recent and pending
          requests once that module ships.
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted mb-2">Documents awaiting your acknowledgment</h2>
        <div className="rounded-xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          The document center isn&apos;t built yet.
        </div>
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
