import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentEmployee } from "@/lib/auth";
import { canAccessEmployeeRecords } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import ReviewTimesheetView from "./ReviewTimesheetView";
import TeamPtoSection from "./TeamPtoSection";

export default async function ReviewEmployeePage(
  props: PageProps<"/team/[employeeId]">
) {
  const { employeeId } = await props.params;

  const reviewer = await getCurrentEmployee();
  if (!reviewer) redirect("/login");

  if (!(await canAccessEmployeeRecords(reviewer, employeeId))) {
    // Same response whether the id doesn't exist or the reviewer just isn't allowed to see
    // it — a supervisor probing other ids by guessing learns nothing either way.
    notFound();
  }

  const target = await withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, (tx) =>
    tx.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: true },
    })
  );
  if (!target) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/team" className="text-sm text-brand hover:underline mb-3 inline-block">
        ← My Team
      </Link>
      <h1 className="text-xl font-semibold">
        {target.preferredName || target.firstName} {target.lastName}
      </h1>
      <p className="text-sm text-muted mb-5">{target.jobTitle}</p>

      <h2 className="text-sm font-medium text-muted mb-2">Timesheet</h2>
      <ReviewTimesheetView employeeId={target.id} />

      <h2 className="text-sm font-medium text-muted mb-2 mt-8">Time Off</h2>
      <TeamPtoSection employeeId={target.id} />
    </div>
  );
}
