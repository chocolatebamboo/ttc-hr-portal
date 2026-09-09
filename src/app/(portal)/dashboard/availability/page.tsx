import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { listMyAvailability } from "@/lib/availability";
import TimeOffSection from "@/components/TimeOffSection";
import AvailabilityStatusSection from "@/components/AvailabilityStatusSection";

/**
 * CB, Sept 2026, on the pink dashboard tile: "I'm not sure if pending PTO and availability...
 * maybe we could combine them just for the sake of, like, making it read cleanly, and it'd
 * be, like, availability." One combined "widget" page — a single pending count up top, same
 * big-number face as /dashboard/week — with the two existing lists (Time off, Availability)
 * underneath so nothing that was on the dashboard is lost, just given its own clean page
 * reachable by tapping the tile instead of crowding the dashboard itself.
 */
export default async function AvailabilityStatusPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

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
