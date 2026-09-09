import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { listMyAvailability, listAdminAvailability } from "@/lib/availability";
import { listAdminPto } from "@/lib/pto-actions";
import TimeOffSection from "@/components/TimeOffSection";
import AvailabilityStatusSection from "@/components/AvailabilityStatusSection";
import TeamAvailabilityCards from "@/components/TeamAvailabilityCards";
import TeamPtoCards from "@/components/TeamPtoCards";

/**
 * CB, Sept 2026, on the pink dashboard tile: "when we go on the pink availability block,
 * that's where I want those things to show... it's not supposed to be a whole different thing
 * where we have to do extra steps." Tapping the tile now takes an admin straight to the same
 * Approve/Deny card roster that used to live only behind Team Availability / PTO Management in
 * the nav — same TeamAvailabilityCards/TeamPtoCards components those pages render, so there's
 * one card implementation whichever way you got here. A regular employee still lands on their
 * own personal summary below, unchanged from before.
 */
export default async function AvailabilityStatusPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  if (isAdmin(employee)) {
    const [availability, ptoSummary] = await Promise.all([
      listAdminAvailability(employee),
      listAdminPto(employee),
    ]);
    const pendingTotal = availability.pending.length + ptoSummary.pending.length;

    return (
      <div className="max-w-3xl">
        <Link href="/dashboard" className="text-sm text-muted hover:text-accent-ink mb-3 inline-block">
          ← Home
        </Link>

        {/* Same big-number, solid-color "widget" face as the employee view below and
            /dashboard/week — just counting org-wide pending decisions instead of one person's
            own. */}
        <div className="rounded-3xl p-6 text-white shadow-lg" style={{ background: "var(--ttc-pink)" }}>
          <p className="text-xs uppercase tracking-wide text-white/70 mb-1">Availability</p>
          <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{pendingTotal}</p>
          <p className="text-sm font-medium text-white/75 mt-2">
            {pendingTotal === 0 ? "Nothing waiting on your review" : `${pendingTotal} pending across the team`}
          </p>
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted mb-2">Availability requests</h2>
          <TeamAvailabilityCards />
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted mb-2">Time off requests</h2>
          <TeamPtoCards />
        </div>
      </div>
    );
  }

  const recentAvailability = (await listMyAvailability(employee)).slice(0, 3);

  const { recentPto, pendingPtoCount, pendingMyAvailabilityCount } = await withRlsContext(
    { employeeId: employee.id, role: employee.role },
    async (tx) => {
      const [recentPto, pendingPtoCount, pendingMyAvailabilityCount] = await Promise.all([
        tx.ptoRequest.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: "desc" }, take: 3 }),
        tx.ptoRequest.count({ where: { employeeId: employee.id, status: "PENDING" } }),
        tx.availabilitySubmission.count({ where: { employeeId: employee.id, status: "PENDING" } }),
      ]);
      return { recentPto, pendingPtoCount, pendingMyAvailabilityCount };
    }
  );

  const pendingTotal = pendingPtoCount + pendingMyAvailabilityCount;

  return (
    <div className="max-w-md">
      <Link href="/dashboard" className="text-sm text-muted hover:text-accent-ink mb-3 inline-block">
        ← Home
      </Link>

      {/* Same big-number, solid-color "widget" face as /dashboard/week and TimeClockCard's
          hero variant. */}
      <div className="rounded-3xl p-6 text-white shadow-lg" style={{ background: "var(--ttc-pink)" }}>
        <p className="text-xs uppercase tracking-wide text-white/70 mb-1">Availability</p>
        <p className="text-5xl font-bold tabular-nums leading-none tracking-tight">{pendingTotal}</p>
        <p className="text-sm font-medium text-white/75 mt-2">
          {pendingTotal === 0
            ? "Nothing waiting on a decision"
            : `${pendingTotal} pending ${pendingTotal === 1 ? "request" : "requests"}`}
        </p>
      </div>

      <div className="mt-5 space-y-5">
        <TimeOffSection recentPto={recentPto} />
        <AvailabilityStatusSection recentAvailability={recentAvailability} />
      </div>
    </div>
  );
}
