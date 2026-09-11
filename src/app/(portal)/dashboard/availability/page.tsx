import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { listMyAvailability } from "@/lib/availability";
import TimeOffSection from "@/components/TimeOffSection";
import AvailabilityStatusSection from "@/components/AvailabilityStatusSection";
import TeamAvailabilityCards from "@/components/TeamAvailabilityCards";
import TeamPtoCards from "@/components/TeamPtoCards";

export default async function AvailabilityStatusPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  // CB, round four: the pink "N pending" hero that used to sit above these lists was confusing
  // rather than useful — "I don't think pending should even show... I don't know what that's
  // even for" — especially once it read 0. Removed entirely; TeamAvailabilityCards/TeamPtoCards
  // already carry their own "Pending (N)"/"Decided (N)" section headers below, which is the
  // count that actually matters here.
  if (isAdmin(employee)) {
    return (
      <div className="max-w-3xl">
        <Link href="/dashboard" className="text-sm text-muted hover:text-accent-ink mb-3 inline-block">
          ← Home
        </Link>

        <div className="mt-4">
          <h2 className="text-sm font-medium text-muted mb-2">Availability requests</h2>
          <TeamAvailabilityCards viewerId={employee.id} />
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted mb-2">Time off requests</h2>
          <TeamPtoCards viewerId={employee.id} />
        </div>
      </div>
    );
  }

  const recentAvailability = (await listMyAvailability(employee)).slice(0, 3);

  const recentPto = await withRlsContext({ employeeId: employee.id, role: employee.role }, async (tx) => {
    return tx.ptoRequest.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: "desc" }, take: 3 });
  });

  return (
    <div className="max-w-md">
      <Link href="/dashboard" className="text-sm text-muted hover:text-accent-ink mb-3 inline-block">
        ← Home
      </Link>

      <div className="mt-4 space-y-5">
        <TimeOffSection recentPto={recentPto} />
        <AvailabilityStatusSection recentAvailability={recentAvailability} />
      </div>
    </div>
  );
}
